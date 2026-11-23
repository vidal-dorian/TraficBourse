# Mise en service : brancher Claude à l'app

Procédure à suivre une fois, à la main, pour que les tâches planifiées de claude.ai publient le brief
chaque matin. La configuration dans claude.ai et dans Cloudflare n'est pas dans le dépôt : ce guide la
décrit. Le prompt des tâches est dans [prompt-tache-planifiee.md](./prompt-tache-planifiee.md).

## 1. Prérequis

- L'app tourne sur le Pi selon [DEPLOY.md](../DEPLOY.md) et répond sur son domaine public
  (`curl -s https://<domaine>/api/health`).
- `PUBLIC_URL` dans le `.env` du Pi : l'origine https exacte du site, sans chemin ni `/` final
  (`https://bourse.example.com`).
- Au moins une des deux authentifications de `/api/mcp` :
  - **Option A, jeton** : `MCP_TOKEN` dans le `.env`. Générer la valeur avec `openssl rand -hex 32`, la
    garder dans un gestionnaire de mots de passe, ne jamais la commiter.
  - **Option B, OAuth** : `MCP_OAUTH_PASSWORD` d'au moins 16 caractères (`openssl rand -base64 24`) et
    `PUBLIC_URL`.
- Après toute modification du `.env` : `docker compose up -d --no-build` (relance `web`).

## 2. Cloudflare Access

Claude ne peut pas passer Cloudflare Access (code à usage unique par e-mail). L'app protège donc elle-même
`/api/mcp` et les chemins OAuth ; Access doit seulement les laisser passer.

1. Application Access qui protège `/admin`, avec une règle Allow sur votre e-mail. Elle est décrite dans le
   [README](../README.md#cloudflare-access-setup-manual-done-once-in-the-zero-trust-dashboard).
2. Si une application Access couvre aussi ces chemins (par exemple tout le nom d'hôte), ajouter une règle
   **Bypass** qui exclut exactement :
   - `/api/mcp`
   - `/.well-known/oauth-protected-resource*`
   - `/.well-known/oauth-authorization-server`
   - `/oauth/register`, `/oauth/token` et `/oauth/authorize`

   Les chemins `/oauth/` et `/.well-known/oauth-` ne servent qu'à l'option B ; sans elle, `/api/mcp` suffit.
3. Ne jamais contourner le domaine entier, ni `/admin`, ni un joker comme `/oauth/*` ou `/.well-known/*`.
   `/admin` reste protégé par Access.
4. Ajouter une règle de limitation de débit (rate limiting) Cloudflare sur `/api/mcp` et sur `/oauth/*` :
   seule Cloudflare arrête un flot de requêtes avant qu'il n'atteigne le Pi.

## 3. Ajouter le connecteur dans claude.ai

Dans claude.ai, Réglages, Connecteurs, « Ajouter un connecteur personnalisé » :

- **URL** : `<PUBLIC_URL>/api/mcp`, par exemple `https://bourse.example.com/api/mcp`.
- **Option A (préférée)** : si la boîte de dialogue propose « Request headers », ajouter l'en-tête
  `Authorization: Bearer <MCP_TOKEN>`, avec la valeur du `.env` à la place du marqueur. La fonction est en
  bêta et n'est pas ouverte à tous les comptes.
- **Option B** : sans « Request headers », ne mettre aucun en-tête. Claude affiche la page de connexion de
  l'app (`/oauth/authorize`) : saisir `MCP_OAUTH_PASSWORD`. La session dure au plus 90 jours, puis il faut se
  reconnecter ; changer le mot de passe révoque toutes les sessions.

Ne jamais utiliser de connecteur sans authentification qui compterait sur une URL secrète. Une fois ajouté,
le connecteur doit lister les outils `publish_brief` et `get_recent_briefs`.

## 4. Créer les deux tâches planifiées

Dans claude.ai, créer deux tâches planifiées, avec le connecteur ci-dessus activé. Le prompt de chacune est
le bloc correspondant de [prompt-tache-planifiee.md](./prompt-tache-planifiee.md) ; ce fichier est la
version en vigueur, à recopier telle quelle.

| Tâche | Quand | `kind` | Prompt |
| --- | --- | --- | --- |
| Brief de la semaine | du lundi au vendredi, vers 07:00 (Europe/Paris) | `daily` | « Brief de la semaine » |
| Récapitulatif du samedi | le samedi, vers 09:00 (Europe/Paris) | `weekly` | « Récapitulatif du samedi » |

Vérifier que le fuseau horaire de chaque tâche est bien Europe/Paris. Quand un ticket change les outils ou le
contrat, recopier le prompt mis à jour dans les deux tâches.

## 5. Premier essai manuel et vérification

1. Dans claude.ai, lancer la tâche de la semaine à la main (essai manuel), sans attendre 07:00.
2. Sur le Pi, interroger la base en lecture seule. Le fichier est `bourse.db` dans `BOURSE_DATA_DIR`
   (`/mnt/data/bourse` par défaut, voir [DEPLOY.md](../DEPLOY.md)) ; le client `sqlite3` s'installe sur
   l'hôte (`sudo apt install sqlite3`) :

   ```bash
   DB=/mnt/data/bourse/bourse.db
   sqlite3 -readonly -header -column "$DB" \
     "SELECT id, date, kind, status, mood, published_at FROM briefs ORDER BY date DESC, kind LIMIT 5;"
   sqlite3 -readonly -header -column "$DB" \
     "SELECT n.rank, n.category, n.title FROM news_items n JOIN briefs b ON b.id = n.brief_id ORDER BY b.date DESC, n.rank LIMIT 5;"
   sqlite3 -readonly -header -column "$DB" \
     "SELECT id, tool, ok, error, duration_ms, datetime(at, 'unixepoch') AS at_utc FROM mcp_audit ORDER BY id DESC LIMIT 10;"
   ```

3. Résultat attendu : une ligne `briefs` en `status` `published` pour la date du jour et `kind` `daily`,
   avec ses actualités ; dans `mcp_audit`, au moins `get_recent_briefs`, puis `publish_brief` deux fois
   (`dry_run` à true, puis à false), toutes avec `ok` à 1 et `error` vide. L'heure `at` est en UTC.
4. Relancer la tâche est sans danger : le brief d'une date et d'un type est remplacé, jamais dupliqué.
5. Le brief s'affichera sur « Aujourd'hui » quand le ticket T4 (pages publiques) sera livré ; d'ici là, la
   vérification passe par la base.

Faire le même essai pour la tâche du samedi (`kind` `weekly`) avant le premier samedi.

## 6. Dépannage

| Symptôme | Cause probable |
| --- | --- |
| Le connecteur ou un appel répond `401` | Jeton absent ou différent de `MCP_TOKEN` ; `MCP_TOKEN` vide dans le `.env` (l'app refuse tout, par sécurité) ; `web` pas relancé après la modification ; session OAuth expirée ou révoquée (se reconnecter). |
| `401` avant même d'arriver à l'app, ou page de connexion Cloudflare | La règle Bypass ne couvre pas `/api/mcp` (ou un chemin OAuth) : voir la section 2. |
| OAuth : les points de terminaison répondent `503` | `PUBLIC_URL` absent du `.env`. |
| OAuth : connexion refusée, ou `429` | Mot de passe faux, ou trop d'essais ratés : verrouillage de 15 minutes après 5 échecs. |
| `publish_brief` renvoie une erreur de validation | Le résultat liste toutes les erreurs, une ligne « chemin : message » par champ (par exemple `payload.news.0.sourceUrl : …`). Un champ de trop (`stockNotes`, `concept`, `storylineUpdates`, `chart`) est aussi une erreur : vérifier que le prompt des tâches est la version de [prompt-tache-planifiee.md](./prompt-tache-planifiee.md). La tâche corrige et recommence ; rien n'est écrit tant que la validation échoue. |
| Aucune ligne dans `briefs` mais des lignes dans `mcp_audit` | Les appels sont arrivés mais `publish_brief` a échoué : lire la colonne `error`. Un `dry_run` à true n'écrit rien non plus. |
| Rien dans `mcp_audit` | Aucun appel n'est arrivé : connecteur non activé dans la tâche, ou mauvaise URL. |
