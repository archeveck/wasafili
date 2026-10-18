-- Les policies de lecture « propres lignes » ne s'appliquent plus qu'hors contexte d'instance.
-- Sinon, combinées (OR) à tenant_isolation, elles exposaient dans une instance les adhésions
-- de l'utilisateur courant aux autres instances.

DROP POLICY own_memberships_read ON memberships;
CREATE POLICY own_memberships_read ON memberships FOR SELECT
  USING (app_current_instance() IS NULL AND user_id = app_current_user());

DROP POLICY authenticating_client_read ON oauth_clients;
CREATE POLICY authenticating_client_read ON oauth_clients FOR SELECT
  USING (app_current_instance() IS NULL AND client_id = app_current_oauth_client());
