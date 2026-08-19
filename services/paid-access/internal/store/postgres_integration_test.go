package store

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/fenghaoyun-monster/freedompost/services/paid-access/internal/auth"
	"github.com/fenghaoyun-monster/freedompost/services/paid-access/internal/domain"
)

func TestOrderCompletionGrantsEntitlementAndPasswordResetRevokesSessions(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	database, err := Open(ctx, databaseURL)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer database.Close()

	var postID string
	err = database.pool.QueryRow(ctx, `
		INSERT INTO posts (slug, title, content_json, content_markdown, content_html, search_text, excerpt, visibility, price_cents, currency)
		VALUES ('paid-integration', 'Integration paid post', '{}', 'secret', '<p>secret</p>', 'secret', 'preview', 'paid', 1299, 'CNY')
		RETURNING id`).Scan(&postID)
	if err != nil {
		t.Fatalf("insert post: %v", err)
	}

	passwordHash, err := auth.HashPassword("integration password")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	account, err := database.CreateAccount(ctx, "IntegrationReader", "integrationreader", passwordHash)
	if err != nil {
		t.Fatalf("CreateAccount: %v", err)
	}
	defer func() {
		cleanup := context.Background()
		_, _ = database.pool.Exec(cleanup, `DELETE FROM article_entitlements WHERE account_id = $1`, account.ID)
		_, _ = database.pool.Exec(cleanup, `DELETE FROM article_orders WHERE account_id = $1`, account.ID)
		_, _ = database.pool.Exec(cleanup, `DELETE FROM reader_sessions WHERE account_id = $1`, account.ID)
		_, _ = database.pool.Exec(cleanup, `DELETE FROM reader_accounts WHERE id = $1`, account.ID)
		_, _ = database.pool.Exec(cleanup, `DELETE FROM posts WHERE id = $1`, postID)
	}()

	token, tokenHash, err := auth.NewSessionToken()
	if err != nil || token == "" {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if err := database.CreateSession(ctx, account.ID, tokenHash, account.CredentialVersion, domain.SessionMetadata{}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	article, err := database.FindArticle(ctx, "paid-integration")
	if err != nil {
		t.Fatalf("FindArticle: %v", err)
	}
	type orderResult struct {
		order   domain.Order
		created bool
		err     error
	}
	results := make(chan orderResult, 2)
	start := make(chan struct{})
	var workers sync.WaitGroup
	for range 2 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			order, created, err := database.CreateOrder(ctx, account.ID, article)
			results <- orderResult{order: order, created: created, err: err}
		}()
	}
	close(start)
	workers.Wait()
	close(results)

	var order domain.Order
	createdCount := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent CreateOrder: %v", result.err)
		}
		if order.ID == "" {
			order = result.order
		} else if result.order.ID != order.ID {
			t.Fatalf("concurrent requests produced different orders: %s and %s", order.ID, result.order.ID)
		}
		if result.created {
			createdCount++
		}
	}
	if createdCount != 1 {
		t.Fatalf("concurrent requests created %d orders, want 1", createdCount)
	}

	completed, err := database.UpdateOrderStatus(ctx, order.ID, "completed", "integration-admin")
	if err != nil || completed.Status != "completed" {
		t.Fatalf("UpdateOrderStatus: order=%#v err=%v", completed, err)
	}
	entitled, err := database.HasEntitlement(ctx, account.ID, postID)
	if err != nil || !entitled {
		t.Fatalf("HasEntitlement: entitled=%v err=%v", entitled, err)
	}
	if _, err := database.UpdateOrderStatus(ctx, order.ID, "canceled", "integration-admin"); !errors.Is(err, domain.ErrInvalidState) {
		t.Fatalf("completed order must be terminal, got %v", err)
	}

	newHash, _ := auth.HashPassword("new integration password")
	if err := database.ResetPassword(ctx, account.ID, newHash, "integration-admin"); err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}
	if _, err := database.FindAccountBySession(ctx, tokenHash); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("old session remained valid after reset: %v", err)
	}
}
