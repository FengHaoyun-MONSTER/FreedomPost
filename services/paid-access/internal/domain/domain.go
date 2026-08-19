package domain

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound        = errors.New("not found")
	ErrConflict        = errors.New("conflict")
	ErrAlreadyEntitled = errors.New("article already entitled")
	ErrInvalidState    = errors.New("invalid state transition")
)

type Account struct {
	ID                string    `json:"id"`
	LoginName         string    `json:"loginName"`
	NormalizedLogin   string    `json:"-"`
	PasswordHash      string    `json:"-"`
	CredentialVersion int       `json:"-"`
	Status            string    `json:"status"`
	CreatedAt         time.Time `json:"createdAt"`
}

type Article struct {
	ID              string    `json:"-"`
	Slug            string    `json:"slug"`
	Title           string    `json:"title"`
	Excerpt         string    `json:"excerpt"`
	ContentHTML     string    `json:"contentHtml,omitempty"`
	Visibility      string    `json:"visibility"`
	PriceCents      int       `json:"priceCents"`
	Currency        string    `json:"currency"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	ViewCount       int64     `json:"viewCount"`
	CommentCount    int64     `json:"commentCount"`
	AttachmentCount int64     `json:"attachmentCount"`
}

type Order struct {
	ID          string     `json:"id"`
	OrderCode   string     `json:"orderCode"`
	AccountID   string     `json:"accountId"`
	LoginName   string     `json:"loginName,omitempty"`
	PostID      string     `json:"postId"`
	PostSlug    string     `json:"postSlug"`
	PostTitle   string     `json:"postTitle"`
	PriceCents  int        `json:"priceCents"`
	Currency    string     `json:"currency"`
	Status      string     `json:"status"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	CompletedAt *time.Time `json:"completedAt"`
}

type SessionMetadata struct {
	UserAgentHash string
	IPHash        string
}

type Store interface {
	CreateAccount(context.Context, string, string, string) (Account, error)
	FindAccountByLogin(context.Context, string) (Account, error)
	CreateSession(context.Context, string, string, int, SessionMetadata) error
	FindAccountBySession(context.Context, string) (Account, error)
	TouchSession(context.Context, string) error
	RevokeSession(context.Context, string) error
	RevokeAllSessions(context.Context, string) error
	FindArticle(context.Context, string) (Article, error)
	HasEntitlement(context.Context, string, string) (bool, error)
	CreateOrder(context.Context, string, Article) (Order, bool, error)
	ListAccountOrders(context.Context, string) ([]Order, error)
	ListAdminOrders(context.Context) ([]Order, error)
	UpdateOrderStatus(context.Context, string, string, string) (Order, error)
	ListAccounts(context.Context) ([]Account, error)
	ResetPassword(context.Context, string, string, string) error
	Close()
}
