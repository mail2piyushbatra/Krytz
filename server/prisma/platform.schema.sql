CREATE TABLE IF NOT EXISTS organizations (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('founder','operator','devops','coder','support','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(org_id, role);

CREATE TABLE IF NOT EXISTS platform_audit_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_org ON platform_audit_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_actor ON platform_audit_events(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_invites (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('founder','operator','devops','coder','support','member')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_invites_org ON platform_invites(org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_support_notes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  author_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  note           TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'diagnostic',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_support_notes_subject ON platform_support_notes(subject_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_data_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  requester_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('export','delete')),
  status          TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','completed','rejected')),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_data_requests_subject ON platform_data_requests(subject_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_backup_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'completed',
  manifest       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_backup_runs_created ON platform_backup_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS platform_deploy_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  environment    TEXT NOT NULL,
  component      TEXT NOT NULL,
  ref            TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_deploy_runs_created ON platform_deploy_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS platform_observability_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source         TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('info','warn','error','critical')),
  message        TEXT NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_platform_observability_created ON platform_observability_events(created_at DESC);
