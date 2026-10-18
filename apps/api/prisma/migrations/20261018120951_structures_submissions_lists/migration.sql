-- CreateEnum
CREATE TYPE "StructureVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "structures" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structure_versions" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StructureVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "structure_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "structure_version_id" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "state" TEXT,
    "author_id" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_revisions" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "author_id" UUID,
    "client_mutation_id" TEXT,
    "changes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lists" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "levels" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "list_items" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "parent_id" UUID,
    "level" INTEGER NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "structures_instance_id_name_idx" ON "structures"("instance_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "structures_id_instance_id_key" ON "structures"("id", "instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "structure_versions_structure_id_version_key" ON "structure_versions"("structure_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "structure_versions_id_instance_id_key" ON "structure_versions"("id", "instance_id");

-- CreateIndex
CREATE INDEX "submissions_instance_id_structure_id_created_at_idx" ON "submissions"("instance_id", "structure_id", "created_at");

-- CreateIndex
CREATE INDEX "submissions_instance_id_updated_at_idx" ON "submissions"("instance_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_id_instance_id_key" ON "submissions"("id", "instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_revisions_submission_id_revision_key" ON "submission_revisions"("submission_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "submission_revisions_instance_id_client_mutation_id_key" ON "submission_revisions"("instance_id", "client_mutation_id");

-- CreateIndex
CREATE UNIQUE INDEX "lists_instance_id_name_key" ON "lists"("instance_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lists_id_instance_id_key" ON "lists"("id", "instance_id");

-- CreateIndex
CREATE INDEX "list_items_list_id_parent_id_position_idx" ON "list_items"("list_id", "parent_id", "position");

-- CreateIndex
CREATE INDEX "list_items_instance_id_code_idx" ON "list_items"("instance_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "list_items_list_id_code_key" ON "list_items"("list_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "list_items_id_instance_id_key" ON "list_items"("id", "instance_id");

-- AddForeignKey
ALTER TABLE "structures" ADD CONSTRAINT "structures_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_versions" ADD CONSTRAINT "structure_versions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_versions" ADD CONSTRAINT "structure_versions_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_structure_version_id_instance_id_fkey" FOREIGN KEY ("structure_version_id", "instance_id") REFERENCES "structure_versions"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_revisions" ADD CONSTRAINT "submission_revisions_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_revisions" ADD CONSTRAINT "submission_revisions_submission_id_instance_id_fkey" FOREIGN KEY ("submission_id", "instance_id") REFERENCES "submissions"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_revisions" ADD CONSTRAINT "submission_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lists" ADD CONSTRAINT "lists_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_list_id_instance_id_fkey" FOREIGN KEY ("list_id", "instance_id") REFERENCES "lists"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "list_items" ADD CONSTRAINT "list_items_parent_id_instance_id_fkey" FOREIGN KEY ("parent_id", "instance_id") REFERENCES "list_items"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- =====================================================================
-- Isolation (ADR 0001)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['structures', 'structure_versions', 'submissions',
                           'submission_revisions', 'lists', 'list_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (instance_id = app_current_instance()) '
      'WITH CHECK (instance_id = app_current_instance())', t);
  END LOOP;
END $$;

-- =====================================================================
-- Versions de structure : au plus un brouillon et une version courante ; immuables une fois
-- publiées (la définition d'une version qui porte des fiches ne change jamais).
-- =====================================================================
CREATE UNIQUE INDEX structure_versions_one_draft
  ON structure_versions (structure_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX structure_versions_one_published
  ON structure_versions (structure_id) WHERE status = 'PUBLISHED';

CREATE FUNCTION structure_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (
       NEW.definition IS DISTINCT FROM OLD.definition
       OR NEW.version <> OLD.version
       OR NEW.structure_id <> OLD.structure_id
       OR NEW.status = 'DRAFT') THEN
    RAISE EXCEPTION 'version de structure % immuable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER structure_versions_immutable
  BEFORE UPDATE ON structure_versions
  FOR EACH ROW EXECUTE FUNCTION structure_versions_immutable();

-- =====================================================================
-- Fiches : recherche par contenu (data @> {...}) indexée.
-- =====================================================================
CREATE INDEX submissions_data_gin ON submissions USING gin (data jsonb_path_ops);
