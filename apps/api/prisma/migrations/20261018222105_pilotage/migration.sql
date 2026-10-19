-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_client_id" UUID,
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "target_label" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboards" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_exports" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "requested_by_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "pattern" TEXT NOT NULL,
    "entries" JSONB NOT NULL,
    "file_count" INTEGER NOT NULL,
    "key" TEXT,
    "size" BIGINT,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "photo_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_instance_id_created_at_idx" ON "audit_logs"("instance_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_instance_id_action_created_at_idx" ON "audit_logs"("instance_id", "action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_instance_id_actor_user_id_created_at_idx" ON "audit_logs"("instance_id", "actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_instance_id_target_id_idx" ON "audit_logs"("instance_id", "target_id");

-- CreateIndex
CREATE INDEX "dashboards_instance_id_name_idx" ON "dashboards"("instance_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "dashboards_id_instance_id_key" ON "dashboards"("id", "instance_id");

-- CreateIndex
CREATE INDEX "photo_exports_instance_id_created_at_idx" ON "photo_exports"("instance_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "photo_exports_id_instance_id_key" ON "photo_exports"("id", "instance_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_exports" ADD CONSTRAINT "photo_exports_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_exports" ADD CONSTRAINT "photo_exports_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Isolation (ADR 0001). Aucune de ces tables n'est synchronisée vers le mobile.
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dashboards', 'photo_exports'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (instance_id = app_current_instance()) WITH CHECK (instance_id = app_current_instance())',
      t);
  END LOOP;
END $$;

-- Journal d'audit : lecture et ajout dans l'instance courante, rien d'autre. Sans policy
-- UPDATE ni DELETE, la RLS forcée rend une entrée immuable pour le rôle applicatif ; la
-- suppression en cascade d'une instance (exécutée par le propriétaire) reste possible.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs FOR SELECT
  USING (instance_id = app_current_instance());
CREATE POLICY tenant_append ON audit_logs FOR INSERT
  WITH CHECK (instance_id = app_current_instance());

-- Nouvelle permission `dashboard:manage` (P6.2) pour les rôles système existants. Les rôles
-- sont cloisonnés : le contexte de chaque instance est posé avant la mise à jour.
DO $$
DECLARE i uuid;
BEGIN
  FOR i IN SELECT id FROM instances LOOP
    PERFORM set_config('app.instance_id', i::text, true);
    UPDATE roles SET permissions = array_append(permissions, 'dashboard:manage')
      WHERE key IN ('admin', 'superviseur') AND NOT ('dashboard:manage' = ANY (permissions));
  END LOOP;
  PERFORM set_config('app.instance_id', '', true);
END $$;
