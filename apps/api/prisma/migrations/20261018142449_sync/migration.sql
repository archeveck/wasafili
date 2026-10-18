-- AlterTable
ALTER TABLE "list_items" ADD COLUMN     "sync_txid" xid8 NOT NULL DEFAULT pg_current_xact_id();

-- AlterTable
ALTER TABLE "lists" ADD COLUMN     "sync_txid" xid8 NOT NULL DEFAULT pg_current_xact_id();

-- AlterTable
ALTER TABLE "structures" ADD COLUMN     "sync_txid" xid8 NOT NULL DEFAULT pg_current_xact_id();

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "sync_txid" xid8 NOT NULL DEFAULT pg_current_xact_id();

-- CreateTable
CREATE TABLE "submission_conflicts" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "base_revision" INTEGER NOT NULL,
    "applied_revision" INTEGER NOT NULL,
    "applied_value" JSONB NOT NULL,
    "overwritten_value" JSONB NOT NULL,
    "client_mutation_id" TEXT,
    "author_id" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_conflicts_instance_id_submission_id_idx" ON "submission_conflicts"("instance_id", "submission_id");

-- AddForeignKey
ALTER TABLE "submission_conflicts" ADD CONSTRAINT "submission_conflicts_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_conflicts" ADD CONSTRAINT "submission_conflicts_submission_id_instance_id_fkey" FOREIGN KEY ("submission_id", "instance_id") REFERENCES "submissions"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Curseur de synchronisation (ADR 0007) : chaque écriture enregistre l'identifiant de sa
-- transaction. Le pull lit `sync_txid >= plancher`, le plancher étant le xmin du snapshot de
-- la passe précédente : une transaction encore en cours ne peut pas être manquée.
-- =====================================================================
CREATE FUNCTION touch_sync_txid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sync_txid := pg_current_xact_id();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['structures', 'lists', 'list_items', 'submissions'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_sync_txid()',
      t || '_sync_txid', t);
    EXECUTE format('CREATE INDEX %I ON %I (instance_id, sync_txid, id)', t || '_sync', t);
  END LOOP;
END $$;

ALTER TABLE submission_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_conflicts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON submission_conflicts
  USING (instance_id = app_current_instance())
  WITH CHECK (instance_id = app_current_instance());
