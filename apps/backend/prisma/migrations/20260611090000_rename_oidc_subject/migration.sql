-- Auth générique OIDC (Keycloak n'est qu'un fournisseur OIDC) : la colonne
-- d'identité externe est renommée keycloak_sub → oidc_subject.
ALTER TABLE "user" RENAME COLUMN "keycloak_sub" TO "oidc_subject";
ALTER INDEX "user_keycloak_sub_key" RENAME TO "user_oidc_subject_key";
