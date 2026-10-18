-- AlterTable
ALTER TABLE "submission_revisions" ADD COLUMN     "automation_run_id" UUID;

-- CreateTable
CREATE TABLE "report_templates" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "tags" JSONB NOT NULL DEFAULT '[]',
    "filename" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "to" TEXT[],
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "message_id" TEXT,
    "automation_run_id" UUID,
    "step" INTEGER,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "structure_id" UUID,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "disabled_at" TIMESTAMPTZ(3),
    "disabled_reason" TEXT,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_status" INTEGER,
    "error" TEXT,
    "duration_ms" INTEGER,
    "automation_run_id" UUID,
    "step" INTEGER,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "structure_id" UUID,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "conditions" JSONB,
    "actions" JSONB NOT NULL,
    "created_by_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "automation_id" UUID NOT NULL,
    "submission_id" UUID,
    "event_key" TEXT NOT NULL,
    "event" JSONB NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_templates_instance_id_structure_id_idx" ON "report_templates"("instance_id", "structure_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_id_instance_id_key" ON "report_templates"("id", "instance_id");

-- CreateIndex
CREATE INDEX "email_messages_instance_id_created_at_idx" ON "email_messages"("instance_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_automation_run_id_step_key" ON "email_messages"("automation_run_id", "step");

-- CreateIndex
CREATE INDEX "webhooks_instance_id_idx" ON "webhooks"("instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_id_instance_id_key" ON "webhooks"("id", "instance_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_instance_id_webhook_id_created_at_idx" ON "webhook_deliveries"("instance_id", "webhook_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_automation_run_id_step_key" ON "webhook_deliveries"("automation_run_id", "step");

-- CreateIndex
CREATE INDEX "automations_instance_id_structure_id_idx" ON "automations"("instance_id", "structure_id");

-- CreateIndex
CREATE UNIQUE INDEX "automations_id_instance_id_key" ON "automations"("id", "instance_id");

-- CreateIndex
CREATE INDEX "automation_runs_instance_id_created_at_idx" ON "automation_runs"("instance_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_id_instance_id_key" ON "automation_runs"("id", "instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automation_id_event_key_key" ON "automation_runs"("automation_id", "event_key");

-- AddForeignKey
ALTER TABLE "submission_revisions" ADD CONSTRAINT "submission_revisions_automation_run_id_instance_id_fkey" FOREIGN KEY ("automation_run_id", "instance_id") REFERENCES "automation_runs"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_file_id_instance_id_fkey" FOREIGN KEY ("file_id", "instance_id") REFERENCES "files"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_automation_run_id_instance_id_fkey" FOREIGN KEY ("automation_run_id", "instance_id") REFERENCES "automation_runs"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_instance_id_fkey" FOREIGN KEY ("webhook_id", "instance_id") REFERENCES "webhooks"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_automation_run_id_instance_id_fkey" FOREIGN KEY ("automation_run_id", "instance_id") REFERENCES "automation_runs"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_instance_id_fkey" FOREIGN KEY ("automation_id", "instance_id") REFERENCES "automations"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_submission_id_instance_id_fkey" FOREIGN KEY ("submission_id", "instance_id") REFERENCES "submissions"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- =====================================================================
-- Isolation (ADR 0001). Aucune de ces tables n'est synchronisée vers le mobile.
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_templates', 'email_messages', 'webhooks', 'webhook_deliveries',
                           'automations', 'automation_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (instance_id = app_current_instance()) WITH CHECK (instance_id = app_current_instance())',
      t);
  END LOOP;
END $$;
