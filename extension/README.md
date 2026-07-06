# Lygodactylus Web (extension Firefox)

Extension Firefox **Manifest V3** pour traduire, résumer, extraire ou appliquer un prompt libre sur n’importe quelle page web, en s’appuyant sur le serveur **Chat LAN** de [Lygodactylus](../readme.md).

Technologie : JavaScript vanilla, API `browser.*` (Firefox uniquement, pas de polyfill).

---

## Installation (développement)

1. Clonez ce dépôt et assurez-vous que Lygodactylus est installé avec le **Chat LAN** activé.
2. Dans Firefox, ouvrez `about:debugging`.
3. Cliquez sur **Ce Firefox** (ou équivalent), puis **Charger un module complémentaire temporaire…**
4. Sélectionnez le fichier `extension/manifest.json` à la racine du dépôt.
5. L’extension **Lygodactylus Web** apparaît dans la liste. Ouvrez le panneau latéral via l’icône de la barre latérale ou le menu contextuel.

> Les extensions chargées via `about:debugging` sont **temporaires** : elles disparaissent au redémarrage de Firefox. Rechargez le manifest après chaque modification du code.

---

## Configuration

Ouvrez les options de l’extension (clic droit sur l’icône → **Gérer l’extension** → **Préférences**, ou bouton ⚙ dans le panneau latéral).

| Champ | Description |
|--------|-------------|
| **URL du serveur Chat LAN** | Ex. `http://localhost:19890` (port affiché dans Lygodactylus → Réglages → Chat LAN). |
| **Token extension** | Token dédié à l’extension, **distinct** du token global du chat LAN. |
| **Langue cible par défaut** | Utilisée pour l’action « Traduire » (ex. `fr`, `en`). |

### Deux tokens différents

Lygodactylus expose deux jetons dans **Réglages → Chat LAN** :

| Token | Usage |
|--------|--------|
| **Token global (chat LAN)** | Interface web du chat dans le navigateur. **Ne pas** le saisir dans l’extension. |
| **Token extension** | Uniquement l’endpoint `POST /api/web-action` (Bearer). C’est **celui-ci** à copier dans les options de l’extension. |

Le token extension ne donne accès qu’à `/api/web-action` (traduction, résumé, extraction, prompt libre). Il ne permet pas d’utiliser l’interface chat LAN complète.

### Génération et copie du token extension

1. Ouvrez Lygodactylus → **Réglages** → **Chat LAN**.
2. Activez le serveur si nécessaire.
3. Copiez le champ **Token extension** (bouton copier à côté du champ).
4. Collez-le dans les options de l’extension Firefox.

En cas d’erreur **401**, l’extension affiche un message rappelant d’utiliser le **token extension** et non le token global, avec un lien vers les options.

---

## Utilisation

### Menu contextuel (clic droit)

- **Traduire la sélection** — envoie la sélection au serveur, remplace le texte **in-place** à la fin du flux. Un bandeau **Annuler** sur la page restaure le texte original.
- **Résumer la page** — ouvre le panneau latéral et affiche le résumé en streaming.
- **Extraire…** / **Prompt libre…** — ouvre le panneau latéral ; saisissez le prompt puis **Lancer**.

### Panneau latéral natif (`sidebar_action`)

Boutons : **Traduire**, **Résumer**, **Extraire**, **Prompt libre**. Zone de résultat avec affichage au fil de l’eau, **Copier**, **Annuler** (flux en cours).

### Prompt libre et modification de page

Pour des demandes visuelles (ex. « masque les images de cette page »), la réponse du modèle est interprétée comme du **JSON structuré**, jamais exécutée comme du code. Seules ces opérations sont acceptées :

| Opération | Effet |
|-----------|--------|
| `hide` | `display: none` sur les éléments correspondants |
| `remove` | Suppression des nœuds du DOM |
| `replaceText` | Remplacement du `textContent` (champ `text` requis) |

Format attendu :

```json
{
  "operations": [
    { "op": "hide", "selector": "img" }
  ]
}
```

Toute opération hors de cet ensemble est **ignorée** avec un avertissement dans le panneau latéral.

---

## Permissions réseau (`host_permissions`)

Le manifest déclare `http://*/*` et `https://*/*` afin que le **service worker** (`background.js`) puisse appeler le serveur Chat LAN sur l’URL **configurable** par l’utilisateur (souvent `http://127.0.0.1:19890` ou une adresse LAN).

Les appels réseau ne partent **jamais** du content script : cela évite le blocage **mixed content** (page HTTPS → API HTTP locale). Seul le background contacte Lygodactylus.

Aucune autre destination réseau n’est contactée (pas de télémétrie).

---

## Limites connues

- **Pages très dynamiques** (SPA, contenu chargé tardivement) : l’heuristique d’extraction peut capturer un texte incomplet ou du chrome d’interface. Privilégiez une **sélection manuelle** dans ce cas.
- **Iframes cross-origin** : le content script n’y a pas accès ; le contenu embarqué n’est pas extrait ni modifié.
- **Traduction in-place** : nécessite une sélection active au moment du remplacement ; sinon le texte traduit reste affiché uniquement dans le panneau latéral.
- **Chargement temporaire** : recharger l’extension après chaque changement de code en développement.
- **CORS** : le serveur Chat LAN n’accepte que les origines `moz-extension://` pour `/api/web-action`.

---

## Structure

```
extension/
  manifest.json
  background.js
  content.js
  sidebar/
  options/
  lib/extract.js
```

Voir le dépôt principal pour le comportement côté serveur (`src/main/chat-lan-server/web-action.ts`).
