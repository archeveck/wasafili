-- Modèles de rapport HTML (ADR 0009) : stockés en base, le stockage de fichiers refusant les
-- contenus actifs. Un modèle a soit un fichier DOCX, soit du HTML.

-- AlterTable
ALTER TABLE "report_templates" ADD COLUMN     "html" TEXT,
ALTER COLUMN "file_id" DROP NOT NULL;

ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_source"
  CHECK ((file_id IS NULL) <> (html IS NULL));
