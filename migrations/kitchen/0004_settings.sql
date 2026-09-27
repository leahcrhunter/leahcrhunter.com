-- App-wide settings the Worker keeps to itself, such as the Anthropic API key
-- pasted in on "what can we make?". Never sent back to the phones.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
