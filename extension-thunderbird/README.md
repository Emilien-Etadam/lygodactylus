# Lygodactylus Mail (extension Thunderbird / Betterbird)

Extension **Thunderbird / Betterbird** (Manifest V2) pour résumer, traduire, analyser un e-mail et suggérer ou reformuler des réponses, en s’appuyant sur le serveur **Chat LAN** de [Lygodactylus](../readme.md).

C’est le pendant « courrier » de l’extension Firefox [Lygodactylus Web](../extension/README.md) : mêmes réglages (URL du serveur + **token extension**), même endpoint `POST /api/web-action`. Toute la logique de modèle (vLLM, Ollama, API distante…) reste dans Lygodactylus — l’extension est un simple client. **Aucun fournisseur ni clé d’API à configurer dans l’extension.**

Inspiré de [aimailsupport](https://github.com/emilien-etadam/aimailsupport) (MIT) pour les prompts et l’intégration Thunderbird, entièrement retravaillé pour passer par le Chat LAN.

---

## Ce qu’elle fait

Deux boutons de barre d’outils, chacun avec un menu :

### Sur un e-mail affiché (bouton du bandeau de message)

| Action | Effet |
|--------|-------|
| **Résumer** | Résumé de l’e-mail dans votre langue |
| **Traduire** | Traduction vers la langue configurée |
| **Analyser le ton / l’intention** | Comment l’e-mail peut être perçu |
| **Expliquer** | Reformulation claire et simple du contenu |
| **Vérifier les erreurs** | Fautes, incohérences, coquilles |
| **Prompt libre…** | Votre consigne sur le contenu de l’e-mail |

Le résultat s’affiche en streaming dans une petite fenêtre, avec **Copier**.

### Dans la fenêtre de composition (bouton de composition)

| Action | Effet |
|--------|-------|
| **Suggérer une réponse** (ton : standard, formel, amical, concis, développé, poli) | Rédige une réponse au message cité |
| **Reformuler** (même choix de tons) | Réécrit le brouillon |
| **Suggérer des améliorations** | Clarté, ton, efficacité |
| **Vérifier les erreurs** | Fautes et incohérences |
| **Prompt libre…** | Votre consigne sur le brouillon |

Pour les actions qui produisent du texte à envoyer (réponse, reformulation, améliorations), la fenêtre de résultat propose **Insérer dans l’e-mail** : le texte est ajouté en tête du corps du message (texte brut ou HTML selon le mode de composition).

---

## Configuration

Ouvrez les options : `Outils → Modules complémentaires`, roue dentée à côté de **Lygodactylus Mail** → **Options** (ou l’onglet Options).

| Champ | Description |
|-------|-------------|
| **URL du serveur Chat LAN** | Ex. `http://localhost:19890` (Lygodactylus → Réglages → Chat LAN). |
| **Token extension** | Le **même** token extension que l’extension Firefox — Réglages → Chat LAN → Token extension. **Pas** le token global. |
| **Langue des réponses / de traduction** | Ex. `fr`, `en`. |

En cas d’erreur **401**, vérifiez que vous avez bien collé le *token extension* et non le token global.

---

## Installation

Le `.xpi` de l’extension est attaché aux [releases GitHub](https://github.com/Emilien-Etadam/lygodactylus/releases) (tags `tbext-v*`).

### Installation permanente

Thunderbird release exige des modules signés. Deux options :

1. **Signature ATN** — soumettez le `.xpi` à [addons.thunderbird.net](https://addons.thunderbird.net) (canal self-distribution) pour obtenir une version signée, puis `Outils → Modules complémentaires → roue dentée → Installer un module depuis un fichier…`.
2. **Désactiver l’exigence de signature** (usage perso) — dans `about:config`, passez `xpinstall.signatures.required` à `false`, puis installez le `.xpi` via *Installer un module depuis un fichier…*.

### Chargement temporaire (développement)

`Outils → Développement → Débogage des modules` (`about:debugging`) → **Ce Thunderbird** → **Charger un module temporaire…** → sélectionnez `extension-thunderbird/manifest.json`. Le module disparaît au redémarrage.

---

## Packaging

Le `.xpi` est un simple zip du dossier. En local :

```bash
npx web-ext build --source-dir extension-thunderbird/ --artifacts-dir web-ext-artifacts
```

Le workflow [`package-thunderbird-extension.yml`](../.github/workflows/package-thunderbird-extension.yml) le fait automatiquement sur les tags `tbext-vX.Y.Z` (version alignée sur `manifest.json`) et attache le `.xpi` à la release.

---

## Notes

- **Aucune requête réseau** hors du serveur Chat LAN que vous configurez (pas de télémétrie). Le CORS du Chat LAN n’accepte que les origines `moz-extension://`.
- **Iframes / pièces jointes** ne sont pas analysées : seule la partie texte de l’e-mail (ou le corps de composition) est envoyée.
- L’extension réutilise l’endpoint existant (`custom` pour la plupart des actions, `translate` pour la traduction) : **aucune modification du serveur** n’est requise.
