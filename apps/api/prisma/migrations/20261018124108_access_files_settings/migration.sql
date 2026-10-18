-- DropIndex
DROP INDEX "submissions_data_gin";

-- AlterTable
ALTER TABLE "instances" ADD COLUMN     "branding" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "mobile_menu" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "structure_accesses" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "role_id" UUID,
    "group_id" UUID,
    "permissions" TEXT[],
    "visibility" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "structure_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "instance_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "thumbnail_key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "structure_accesses_structure_id_role_id_key" ON "structure_accesses"("structure_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "structure_accesses_structure_id_group_id_key" ON "structure_accesses"("structure_id", "group_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_id_instance_id_key" ON "files"("id", "instance_id");

-- AddForeignKey
ALTER TABLE "structure_accesses" ADD CONSTRAINT "structure_accesses_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_accesses" ADD CONSTRAINT "structure_accesses_structure_id_instance_id_fkey" FOREIGN KEY ("structure_id", "instance_id") REFERENCES "structures"("id", "instance_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_accesses" ADD CONSTRAINT "structure_accesses_role_id_instance_id_fkey" FOREIGN KEY ("role_id", "instance_id") REFERENCES "roles"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structure_accesses" ADD CONSTRAINT "structure_accesses_group_id_instance_id_fkey" FOREIGN KEY ("group_id", "instance_id") REFERENCES "groups"("id", "instance_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE structure_accesses ADD CONSTRAINT structure_accesses_one_target
  CHECK ((role_id IS NULL) <> (group_id IS NULL));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['structure_accesses', 'files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (instance_id = app_current_instance()) '
      'WITH CHECK (instance_id = app_current_instance())', t);
  END LOOP;
END $$;
