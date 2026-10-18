-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "sync_txid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "instance_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignee_user_id" UUID,
    "assignee_group_id" UUID,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3),
    "location_label" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "prefill" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "submission_id" UUID,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "sync_txid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
    "instance_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_instance_id_start_at_idx" ON "tasks"("instance_id", "start_at");

-- CreateIndex
CREATE INDEX "tasks_instance_id_assignee_user_id_idx" ON "tasks"("instance_id", "assignee_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_id_instance_id_key" ON "tasks"("id", "instance_id");

-- CreateIndex
CREATE INDEX "notifications_instance_id_user_id_created_at_idx" ON "notifications"("instance_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "push_tokens_instance_id_user_id_idx" ON "push_tokens"("instance_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_instance_id_token_key" ON "push_tokens"("instance_id", "token");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_group_id_instance_id_fkey" FOREIGN KEY ("assignee_group_id", "instance_id") REFERENCES "groups"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_submission_id_instance_id_fkey" FOREIGN KEY ("submission_id", "instance_id") REFERENCES "submissions"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Isolation (ADR 0001) et curseur de synchronisation (ADR 0007).
-- Les index `*_sync` (instance_id, sync_txid, id) sont écrits à la main : Prisma ne sait pas
-- les déclarer sur une colonne `xid8` et propose de les supprimer — à retirer des migrations
-- générées.
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'notifications', 'push_tokens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (instance_id = app_current_instance()) WITH CHECK (instance_id = app_current_instance())',
      t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['tasks', 'notifications'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_sync_txid()',
      t || '_sync_txid', t);
    EXECUTE format('CREATE INDEX %I ON %I (instance_id, sync_txid, id)', t || '_sync', t);
  END LOOP;
END $$;
