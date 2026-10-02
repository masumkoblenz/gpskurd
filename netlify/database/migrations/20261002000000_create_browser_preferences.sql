CREATE TABLE reber_browser_preferences (
  browser_id TEXT PRIMARY KEY,
  dark_mode BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
