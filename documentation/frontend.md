# relay — Frontend du hackathon

Interface bilingue anglais / français, responsive, réalisée en Astro avec du CSS et du TypeScript natifs. L’anglais est la langue par défaut. Pas de framework client ni de bibliothèque d’interface supplémentaire.

## Lancement

Depuis `code/frontend`, avec Node.js >= 22.23.4 et pnpm :

```sh
pnpm install
pnpm astro dev --background
```

Gestion du serveur : `pnpm astro dev status`, `pnpm astro dev logs`, `pnpm astro dev stop`.

Build statique : `pnpm build`. Aperçu : `pnpm preview`.

## Pages et langues

- `/` : titre animé hôtel / restaurant / commerce, deux prompts à copier et accès aux comptes client / business.
- `/client/login/` et `/client/register/` : formulaires client.
- `/business/login/` et `/business/register/` : formulaires business.
- `/fr/`, `/fr/client/login/`, `/fr/client/register/`, `/fr/business/login/`, `/fr/business/register/` : mêmes pages en français.

Le routage i18n natif d’Astro définit `en` comme langue par défaut sans préfixe et `fr` avec le préfixe `/fr/`. Aucune redirection ne dépend de la langue du navigateur : `/` reste toujours en anglais. Le sélecteur EN / FR conserve la page, le profil et le mode connexion / inscription ; les liens internes et le logo respectent la langue sélectionnée. Les champs de formulaire ne sont pas transmis lors du changement de langue.

Les contenus sont centralisés dans `code/frontend/src/i18n/messages.ts`, avec vérification TypeScript de la structure des traductions. Les chemins localisés sont gérés par `code/frontend/src/i18n/index.ts`. Le titre animé, les formulaires, les erreurs, les notifications, les libellés accessibles, les métadonnées et les prompts copiés utilisent tous la langue de la page. Les balises HTML `lang` et les liens alternatifs `hreflang` sont générés pour chaque page.

Les routes restent légères et réutilisent `code/frontend/src/components/pages/HomePage.astro` et `AuthPage.astro`. Les onglets client / business conservent le mode connexion ou inscription.

## Configuration MCP

Copier `code/frontend/.env.example` vers `code/frontend/.env` et renseigner :

```dotenv
PUBLIC_MCP_CLIENT_URL=https://votre-serveur/client/mcp
PUBLIC_MCP_BUSINESS_URL=https://votre-serveur/business/mcp
```

Ces adresses sont publiques et intégrées aux prompts au build. Ne pas y mettre de token ou de secret. Relancer le build après modification. Sans adresse, le prompt contient `[URL_MCP_CLIENT]` ou `[URL_MCP_BUSINESS]` et demande explicitement l’adresse réelle avant de continuer. Aucun serveur ni package MCP n’est inventé ou installé par le site.

Les prompts anglais et français sont centralisés dans `code/frontend/src/lib/profiles.ts`. La copie utilise l’API Clipboard ; si elle est indisponible ou refusée, une fenêtre traduite propose le texte à sélectionner manuellement. HTTPS (ou localhost) est nécessaire pour la copie automatique.

## Authentification

Les formulaires sont branchés au backend Fastify via `code/frontend/src/lib/auth-api.ts` et `code/frontend/src/scripts/auth-form.ts`. Renseigner `PUBLIC_API_BASE_URL` dans `.env` (origine du backend, sans `/api/auth`, par défaut `http://localhost:3000`) et démarrer le backend avec MongoDB et un `JWT_SECRET` configurés. Ajouter l’origine réelle du frontend à `FRONTEND_URL` côté backend.

- Client → `/api/auth/clients/register` et `/api/auth/clients/login`.
- Business → `/api/auth/owners/register` et `/api/auth/owners/login` : le modèle backend est un compte propriétaire, avec prénom et nom, pas une fiche d’établissement.
- L’inscription connecte automatiquement l’utilisateur. La page affiche ensuite son identité et une commande de déconnexion. Une session existante est retrouvée avec `/api/auth/me`, notamment après rechargement ou changement de langue.
- Les appels utilisent `credentials: include` et un cookie HttpOnly. Aucun JWT ni mot de passe n’est écrit dans `localStorage` ou `sessionStorage`.
- Les formulaires valident les champs et affichent les erreurs API en anglais ou en français. Les doubles soumissions sont bloquées pendant les requêtes, qui expirent après 15 secondes.

Les pages restent statiques ; la sécurité et la persistance sont assurées par le backend, pas par le masquage des formulaires. En production, utiliser HTTPS et des origines frontend / backend appartenant au même site pour le cookie SameSite=Lax. Voir [authentification backend](./auth.md) pour les contrats, la configuration et les limites.

## Direction artistique

Identité provisoire « relay », avec une palette inspirée du [site officiel BaselHack](https://www.baselhack.ch/) : fond noir / anthracite et jaune citron. Couleurs relevées dans sa feuille de style : `#F2E94D` (jaune principal), `#F5EE73` (jaune clair), `#EEE319` (jaune soutenu), `#171717` et `#262626` (surfaces). Les tokens sont centralisés dans `code/frontend/src/styles/global.css` et appliqués à l’accueil, aux formulaires, aux menus, aux notifications et à la fenêtre de copie. DM Sans reste la police de lecture ; Fira Code, utilisée par BaselHack, ponctue le pied de page. Les polices ont des alternatives de secours.

Les pictogrammes viennent de **Bootstrap Icons 1.11.3**, la même bibliothèque et version que le site officiel. Seuls les SVG nécessaires sont intégrés en HTML depuis le package local, via `Icon.astro` : aucune police d’icônes ni requête CDN n’est nécessaire. Les pictogrammes hôtel, restaurant et commerce remplacent les emojis du carrousel ; l’éclair rappelle le vocabulaire graphique de BaselHack. Licence MIT distribuée dans `code/frontend/public/licenses/bootstrap-icons.txt`. L’identité « relay » reste distincte du logo officiel BaselHack.

Accueil compact sans illustration ni bloc marketing ; formulaires centrés sans panneau décoratif. Le nom peut être remplacé dans `Brand.astro`, les métadonnées et les prompts.

Le titre de découverte (`DiscoveryHeading.astro`) fait défiler les catégories hôtel / restaurant / commerce dans la langue sélectionnée, verticalement en CSS et sans déplacement de la mise en page. Une commande permet de mettre l’animation en pause. Le titre complet reste stable pour les lecteurs d’écran ; le défilement est désactivé avec `prefers-reduced-motion` ou sans JavaScript.
