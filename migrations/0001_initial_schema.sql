-- Initial database schema for OpenShort.link

-- Links table
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  redirect_code INTEGER DEFAULT 301,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expired', 'archived', 'deleted')),
  expires_at INTEGER,
  password_hash TEXT,
  metadata TEXT,
  click_count INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (domain_id) REFERENCES domains(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE(domain_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_links_domain ON links(domain_id);
CREATE INDEX IF NOT EXISTS idx_links_status ON links(status);
CREATE INDEX IF NOT EXISTS idx_links_slug ON links(slug);
CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at);
CREATE INDEX IF NOT EXISTS idx_links_domain_slug ON links(domain_id, slug);

-- Domains table
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  cloudflare_account_id TEXT NOT NULL,
  domain_name TEXT NOT NULL UNIQUE,
  routing_path TEXT NOT NULL,
  default_redirect_code INTEGER DEFAULT 301,
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'pending')),
  settings TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_domains_account ON domains(cloudflare_account_id);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_domains_name ON domains(domain_name);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain_id TEXT,
  color TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id),
  UNIQUE(domain_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tags_domain ON tags(domain_id);

-- Link Tags (Many-to-Many)
CREATE TABLE IF NOT EXISTS link_tags (
  link_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (link_id, tag_id),
  FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_link_tags_link ON link_tags(link_id);
CREATE INDEX IF NOT EXISTS idx_link_tags_tag ON link_tags(tag_id);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain_id TEXT,
  icon TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (domain_id) REFERENCES domains(id),
  UNIQUE(domain_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_domain ON categories(domain_id);

-- Link Categories (Many-to-One relationship stored in links table)
-- category_id column added via migration if needed

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  cloudflare_access_id TEXT,
  role TEXT DEFAULT 'owner' CHECK(role IN ('owner', 'admin', 'editor', 'viewer')),
  preferences TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_access_id ON users(cloudflare_access_id);

-- Analytics Aggregations
CREATE TABLE IF NOT EXISTS analytics_daily (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  date TEXT NOT NULL,
  clicks INTEGER DEFAULT 0,
  unique_visitors INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_link ON analytics_daily(link_id);
CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(date);

CREATE TABLE IF NOT EXISTS analytics_geo (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  country TEXT,
  city TEXT,
  clicks INTEGER DEFAULT 0,
  date TEXT NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, country, city, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_geo_link ON analytics_geo(link_id);
CREATE INDEX IF NOT EXISTS idx_analytics_geo_date ON analytics_geo(date);

CREATE TABLE IF NOT EXISTS analytics_referrers (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  referrer_domain TEXT,
  clicks INTEGER DEFAULT 0,
  date TEXT NOT NULL,
  FOREIGN KEY (link_id) REFERENCES links(id),
  UNIQUE(link_id, referrer_domain, date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_referrers_link ON analytics_referrers(link_id);
CREATE INDEX IF NOT EXISTS idx_analytics_referrers_date ON analytics_referrers(date);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  domain_id TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  FOREIGN KEY (domain_id) REFERENCES domains(id),
  FOREIGN KEY (updated_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_settings_domain ON settings(domain_id);

