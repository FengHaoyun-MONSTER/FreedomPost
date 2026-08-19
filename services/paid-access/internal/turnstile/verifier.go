package turnstile

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"
)

const SiteVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

var (
	ErrRejected    = errors.New("turnstile challenge was rejected")
	ErrUnavailable = errors.New("turnstile verification is unavailable")
)

type Config struct {
	SecretKey        string
	ExpectedHostname string
	HTTPClient       *http.Client
	Now              func() time.Time
}

type Verifier struct {
	secretKey string
	hostname  string
	client    *http.Client
	now       func() time.Time
}

type responsePayload struct {
	Success     bool     `json:"success"`
	ChallengeTS string   `json:"challenge_ts"`
	Hostname    string   `json:"hostname"`
	Action      string   `json:"action"`
	ErrorCodes  []string `json:"error-codes"`
}

func New(config Config) (*Verifier, error) {
	if len(config.SecretKey) < 20 || len(config.SecretKey) > 256 {
		return nil, errors.New("TURNSTILE_SECRET_KEY is invalid")
	}
	hostname := strings.ToLower(strings.TrimSpace(config.ExpectedHostname))
	if hostname == "" || strings.ContainsAny(hostname, "/:") {
		return nil, errors.New("TURNSTILE_EXPECTED_HOSTNAME is invalid")
	}
	client := config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 3 * time.Second}
	}
	now := config.Now
	if now == nil {
		now = time.Now
	}
	return &Verifier{secretKey: config.SecretKey, hostname: hostname, client: client, now: now}, nil
}

func (verifier *Verifier) Verify(ctx context.Context, token, remoteIP, expectedAction string) error {
	if len(token) < 20 || len(token) > 4096 || !utf8.ValidString(token) || !validAction(expectedAction) {
		return ErrRejected
	}
	form := url.Values{"secret": {verifier.secretKey}, "response": {token}}
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	idempotencyKey, err := newIdempotencyKey()
	if err != nil {
		return fmt.Errorf("%w: generate idempotency key", ErrUnavailable)
	}
	form.Set("idempotency_key", idempotencyKey)
	var payload responsePayload
	for attempt := 0; attempt < 2; attempt++ {
		payload, err = verifier.verifyOnce(ctx, form)
		if err == nil {
			break
		}
		if !errors.Is(err, ErrUnavailable) || attempt == 1 {
			return err
		}
	}
	if !payload.Success {
		return ErrRejected
	}
	challengeTime, err := time.Parse(time.RFC3339, payload.ChallengeTS)
	if err != nil {
		return ErrRejected
	}
	age := verifier.now().UTC().Sub(challengeTime.UTC())
	if strings.ToLower(payload.Hostname) != verifier.hostname || payload.Action != expectedAction || age < -time.Minute || age > 5*time.Minute {
		return ErrRejected
	}
	return nil
}

func (verifier *Verifier) verifyOnce(ctx context.Context, form url.Values) (responsePayload, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, SiteVerifyURL, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return responsePayload{}, fmt.Errorf("%w: create request", ErrUnavailable)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := verifier.client.Do(request)
	if err != nil {
		return responsePayload{}, fmt.Errorf("%w: request failed", ErrUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return responsePayload{}, fmt.Errorf("%w: upstream status", ErrUnavailable)
	}
	payloadBytes, err := io.ReadAll(io.LimitReader(response.Body, 16*1024+1))
	if err != nil || len(payloadBytes) > 16*1024 {
		return responsePayload{}, fmt.Errorf("%w: invalid response", ErrUnavailable)
	}
	var payload responsePayload
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return responsePayload{}, fmt.Errorf("%w: invalid response", ErrUnavailable)
	}
	return payload, nil
}

func newIdempotencyKey() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}

func validAction(value string) bool {
	return value == "reader_register" || value == "reader_login"
}
