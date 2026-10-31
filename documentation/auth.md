# Authentification client / business

## Modèle

Les deux profils de l’interface correspondent aux modèles existants du backend :

- **Client** → `Client`, rôle JWT `client`.
- **Business** → `Owner`, rôle JWT `owner`.

Une inscription business crée le compte personnel du propriétaire, pas un document `Business`. La configuration de l’établissement reste un parcours séparé, notamment via les outils MCP existants. Les deux inscriptions demandent `firstName`, `lastName`, `email` et `password`.

## Routes

Toutes les routes sont sous `/api/auth`.

| Méthode | Chemin | Fonction |
| --- | --- | --- |
| POST | `/clients/register` | Inscrire un client et ouvrir sa session (201) |
| POST | `/owners/register` | Inscrire un propriétaire et ouvrir sa session (201) |
| POST | `/clients/login` | Connecter uniquement un client (200) |
| POST | `/owners/login` | Connecter uniquement un propriétaire (200) |
| POST | `/login` | Ancienne connexion commune, conservée pour compatibilité (200) |
| GET | `/me` | Retourner le profil authentifié (200) |
| POST | `/logout` | Effacer le cookie de session, même si la session est expirée (204) |
| PUT | `/clients/preferences` | Modifier les préférences d’un client authentifié (200) |

Inscription :

```json
{
  "firstName": "Camille",
  "lastName": "Martin",
  "email": "camille@example.com",
  "password": "a-long-example-password"
}
```

Connexion :

```json
{
  "email": "camille@example.com",
  "password": "a-long-example-password"
}
```

Les réponses d’inscription / connexion conservent le contrat existant `{ token, role, user }`. `user` contient `id`, `firstName`, `lastName`, `email`, `createdAt`, et les préférences éventuelles du client. Aucun mot de passe ni hash n’est retourné. Le frontend ignore le bearer token retourné : sa session repose sur le cookie HttpOnly. `/me` retourne un profil plat `{ role, id, firstName, lastName, email, createdAt, ... }`.

Une connexion sur le mauvais type de compte retourne le même 401 que des identifiants invalides, sans ouvrir de session. La règle existante qui interdit la réutilisation d’un e-mail déjà inscrit dans l’autre profil est conservée.

## Validation et erreurs

- Prénom et nom : valeurs nettoyées, de 1 à 120 caractères, refus des chaînes composées d’espaces.
- E-mail : nettoyé, normalisé en minuscules et validé, 254 caractères maximum.
- Nouveau mot de passe : 8 caractères minimum et 72 octets UTF-8 maximum pour éviter la troncature silencieuse par bcrypt. Les anciens mots de passe plus courts restent utilisables à la connexion.
- Les mots de passe sont hachés avec bcrypt (coût 10).
- Validation 400 : `code: VALIDATION_ERROR`, avec `details: [{ field, message }]`.
- E-mail déjà utilisé 409 : `code: EMAIL_EXISTS`.
- Identifiants incorrects 401 : `code: INVALID_CREDENTIALS`.
- Origine navigateur interdite 403 : `code: ORIGIN_NOT_ALLOWED`.
- Limite de tentatives dépassée : 429.
- Erreur inattendue 500 : message générique, détails réservés aux logs serveur.

Les mutations d’authentification sont limitées à 10 tentatives par minute, par route et par adresse IP. Ce limiteur est en mémoire et adapté à une instance de démonstration ; un déploiement multi-instance demande un stockage partagé et une configuration de proxy de confiance adaptée.

## Session et sécurité

Le backend émet le cookie `relay_session` avec `HttpOnly`, `SameSite=Lax`, `Path=/api`, expiration de 7 jours et `Secure` lorsque `NODE_ENV=production`. Il est limité à l’hôte de l’API, sans attribut Domain. Les réponses d’authentification utilisent `Cache-Control: no-store`.

Le middleware accepte ce cookie et conserve la compatibilité avec `Authorization: Bearer <token>` pour les clients API. Un en-tête Authorization incorrect n’est jamais remplacé silencieusement par le cookie. Les vérifications de rôle restent côté serveur.

Les origines autorisées sont définies dans `FRONTEND_URL` (liste séparée par des virgules). Le CORS autorise les credentials pour ces seules origines. Les requêtes navigateur qui modifient l’authentification ou utilisent le cookie pour une mutation protégée sont refusées si leur en-tête Origin n’est pas autorisé. Les clients non navigateur sans Origin restent utilisables.

**Déploiement** : frontend et API doivent utiliser HTTPS et être sur le même site (par exemple `app.example.com` et `api.example.com`, ou derrière un proxy de même origine). Les domaines racine différents ne sont pas pris en charge par le cookie SameSite=Lax. En local, garder le même nom d’hôte des deux côtés, par exemple `localhost` pour le frontend et l’API, même si les ports diffèrent.

La déconnexion supprime la session du navigateur. Les JWT restent stateless : un bearer token déjà copié conserve sa validité jusqu’à expiration ; il n’y a pas de liste de révocation ni de refresh token dans ce prototype.

## Configuration

Créer `code/backend/.env` depuis `.env.example`, puis renseigner une connexion MongoDB valide et un secret JWT aléatoire fort :

```dotenv
PORT=3000
FRONTEND_URL=http://localhost:4321,http://localhost:4322
MONGODB_URI=mongodb://localhost:27017/relay
JWT_SECRET=<secret-aléatoire-fort>
```

Générer par exemple le secret avec `openssl rand -hex 32`. Ne pas versionner `.env`. L’inscription vérifie la présence de la configuration JWT avant d’écrire le compte, pour éviter une création partielle liée à un secret manquant.

Depuis `code/backend` :

```sh
npm ci
npm run dev
```

Dans `code/frontend/.env` :

```dotenv
PUBLIC_API_BASE_URL=http://localhost:3000
```

Redémarrer le frontend après modification de l’environnement. Cette variable est publique et intégrée au build ; n’y placer aucun secret. Pour un aperçu servi sur un autre port, ajouter aussi son origine à `FRONTEND_URL`.

## Tests

Depuis `code/backend` :

```sh
npm test
npm run build
```

Les tests utilisent Fastify `inject`, les vrais schémas Zod, bcrypt, JWT, cookies, CORS et limiteur. Seule la persistance est remplacée par des repositories en mémoire : aucune instance MongoDB et aucun secret réel ne sont nécessaires. Ils couvrent les deux profils, la compatibilité Bearer, les refus inter-profils, les sessions expirées, les doublons, la validation, les origines, la limitation de tentatives et les cookies de production. La persistance MongoDB réelle doit être vérifiée avec l’environnement du projet.
