package auth

import "testing"

func TestNormalizeLogin(t *testing.T) {
	t.Parallel()

	got, err := NormalizeLogin("  Ｔｅｓｔ@Example.COM  ")
	if err != nil {
		t.Fatalf("NormalizeLogin returned error: %v", err)
	}
	if got.Display != "Test@Example.COM" || got.Normalized != "test@example.com" {
		t.Fatalf("unexpected normalized login: %#v", got)
	}
}

func TestNormalizeLoginRejectsControlAndShortValues(t *testing.T) {
	t.Parallel()

	for _, value := range []string{"ab", "abc\u200bdef", "abc\ndef"} {
		if _, err := NormalizeLogin(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestNormalizeLoginUsesUnicodeCaseFolding(t *testing.T) {
	t.Parallel()
	left, _ := NormalizeLogin("Straße")
	right, _ := NormalizeLogin("STRASSE")
	if left.Normalized != right.Normalized {
		t.Fatalf("case folded identities differ: %q != %q", left.Normalized, right.Normalized)
	}
}

func TestPasswordPolicyAndHashing(t *testing.T) {
	t.Parallel()

	if err := ValidatePassword("七个字符abc"); err == nil {
		t.Fatal("expected short password to be rejected")
	}
	password := " 一段安全的 password phrase "
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword returned error: %v", err)
	}
	if !VerifyPassword(hash, password) {
		t.Fatal("expected exact password to verify")
	}
	if VerifyPassword(hash, password+"x") {
		t.Fatal("expected changed password to fail")
	}
}

func TestNewSessionToken(t *testing.T) {
	t.Parallel()

	token, hash, err := NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken returned error: %v", err)
	}
	if len(token) < 40 || len(hash) != 64 || HashSessionToken(token) != hash {
		t.Fatalf("unexpected token material: token=%d hash=%q", len(token), hash)
	}
}
