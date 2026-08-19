package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestMemoryLimiterResetsAfterWindow(t *testing.T) {
	limiter := NewMemory()
	now := time.Date(2026, 8, 19, 8, 0, 0, 0, time.UTC)
	limiter.now = func() time.Time { return now }
	for attempt := 0; attempt < 3; attempt++ {
		allowed, err := limiter.Allow(context.Background(), "login", 2, time.Minute)
		if err != nil {
			t.Fatalf("Allow: %v", err)
		}
		if allowed != (attempt < 2) {
			t.Fatalf("attempt %d allowed=%v", attempt, allowed)
		}
	}
	now = now.Add(time.Minute)
	allowed, _ := limiter.Allow(context.Background(), "login", 2, time.Minute)
	if !allowed {
		t.Fatal("expected bucket to reset after the window")
	}
}
