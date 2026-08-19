package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
	"golang.org/x/text/cases"
	"golang.org/x/text/unicode/norm"
)

const (
	minimumPasswordRunes = 8
	maximumPasswordRunes = 128
	maximumPasswordBytes = 1024
	argonMemoryKiB       = 64 * 1024
	argonIterations      = 3
	argonParallelism     = 2
	argonSaltBytes       = 16
	argonKeyBytes        = 32
)

var (
	ErrInvalidLogin    = errors.New("login name must contain 3 to 128 safe Unicode characters")
	ErrInvalidPassword = errors.New("password must contain 8 to 128 Unicode characters")
)

type Login struct {
	Display    string
	Normalized string
}

// NormalizeLogin gives visually compatible Unicode representations one unique identity.
func NormalizeLogin(value string) (Login, error) {
	display := strings.TrimSpace(norm.NFKC.String(value))
	count := utf8.RuneCountInString(display)
	if count < 3 || count > 128 || len(display) > 512 {
		return Login{}, ErrInvalidLogin
	}
	for _, character := range display {
		if unicode.IsControl(character) || unicode.In(character, unicode.Cf) {
			return Login{}, ErrInvalidLogin
		}
	}
	return Login{Display: display, Normalized: cases.Fold().String(display)}, nil
}

func ValidatePassword(password string) error {
	count := utf8.RuneCountInString(password)
	if !utf8.ValidString(password) || count < minimumPasswordRunes || count > maximumPasswordRunes || len(password) > maximumPasswordBytes {
		return ErrInvalidPassword
	}
	return nil
}

func HashPassword(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}
	salt := make([]byte, argonSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	key := argon2.IDKey([]byte(password), salt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", argonMemoryKiB, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func VerifyPassword(encoded, password string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" || parts[2] != "v=19" {
		return false
	}
	var memory uint32
	var iterations uint32
	var parallelism uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism); err != nil {
		return false
	}
	if memory < 8*1024 || memory > 256*1024 || iterations < 1 || iterations > 10 || parallelism < 1 || parallelism > 8 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) < 16 || len(salt) > 64 {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) < 16 || len(want) > 64 || len(password) > maximumPasswordBytes {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func NewSessionToken() (token string, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generate session token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, HashSessionToken(token), nil
}

func HashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func RandomPassword() (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "Fp-" + base64.RawURLEncoding.EncodeToString(raw), nil
}

func DummyHash() string {
	// Fixed salt is intentional: this hash is only used to equalize unknown-account login work.
	salt := []byte("FreedomPostDummy")
	key := argon2.IDKey([]byte("invalid-password-"+strconv.Itoa(argonIterations)), salt, argonIterations, argonMemoryKiB, argonParallelism, argonKeyBytes)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s", argonMemoryKiB, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key))
}
