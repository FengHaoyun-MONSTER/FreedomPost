package turnstile

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) { return fn(request) }

func TestVerifierAcceptsMatchingFreshChallenge(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 19, 8, 0, 0, 0, time.UTC)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != SiteVerifyURL {
			t.Fatalf("unexpected URL: %s", request.URL)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"success":true,"hostname":"example.com","action":"reader_login","challenge_ts":"2026-08-19T07:59:00Z"}`)),
			Header:     make(http.Header),
		}, nil
	})}
	verifier, err := New(Config{SecretKey: strings.Repeat("s", 32), ExpectedHostname: "example.com", HTTPClient: client, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	if err := verifier.Verify(context.Background(), strings.Repeat("t", 32), "203.0.113.10", "reader_login"); err != nil {
		t.Fatalf("Verify returned error: %v", err)
	}
}

func TestVerifierRejectsContextMismatchAndReplayAge(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 19, 8, 0, 0, 0, time.UTC)
	for name, body := range map[string]string{
		"action": `{"success":true,"hostname":"example.com","action":"webmaster_benefit_claim","challenge_ts":"2026-08-19T07:59:00Z"}`,
		"age":    `{"success":true,"hostname":"example.com","action":"reader_login","challenge_ts":"2026-08-19T07:40:00Z"}`,
	} {
		t.Run(name, func(t *testing.T) {
			client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			verifier, err := New(Config{SecretKey: strings.Repeat("s", 32), ExpectedHostname: "example.com", HTTPClient: client, Now: func() time.Time { return now }})
			if err != nil {
				t.Fatalf("New returned error: %v", err)
			}
			if err := verifier.Verify(context.Background(), strings.Repeat("t", 32), "", "reader_login"); err == nil {
				t.Fatal("expected verification to fail")
			}
		})
	}
}

func TestVerifierRetriesTemporaryFailureWithSameIdempotencyKey(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 19, 8, 0, 0, 0, time.UTC)
	attempts := 0
	keys := make([]string, 0, 2)
	client := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		attempts++
		if err := request.ParseForm(); err != nil {
			t.Fatalf("ParseForm: %v", err)
		}
		keys = append(keys, request.Form.Get("idempotency_key"))
		if attempts == 1 {
			return &http.Response{StatusCode: http.StatusServiceUnavailable, Body: io.NopCloser(strings.NewReader("temporary")), Header: make(http.Header)}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"success":true,"hostname":"example.com","action":"reader_login","challenge_ts":"2026-08-19T07:59:00Z"}`)), Header: make(http.Header)}, nil
	})}
	verifier, err := New(Config{SecretKey: strings.Repeat("s", 32), ExpectedHostname: "example.com", HTTPClient: client, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := verifier.Verify(context.Background(), strings.Repeat("t", 32), "", "reader_login"); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if attempts != 2 || keys[0] == "" || keys[0] != keys[1] {
		t.Fatalf("attempts=%d keys=%v", attempts, keys)
	}
}
