# Fiabilité du tool-calling avec les modèles locaux (Qwen3.x / vLLM)

> **Verdict (2026-07-24)** : sur le déploiement de référence
> (**vLLM 0.25.0** + `qwen3.6-27b-fp8`, TP4,
> `--reasoning-parser qwen3 --tool-call-parser qwen3_coder`), le tool-calling est
> **sain** — testé à **64 107 tokens** de contexte, thinking activé,
> `temperature 1.0` : **5/5 appels structurés** (`finish_reason=tool_calls`).
> Le bug historique « tool call émis en texte / piégé dans le raisonnement » est
> **corrigé côté serveur** depuis vLLM 0.25.0 **pour le cas simple**.
>
> **⚠️ Mise à jour (2026-07-24)** : ce verdict « sain » ne vaut que pour un test
> simple (1 outil, contexte court). **En agentique réel** — beaucoup d'outils MCP
> + contexte profond (~70K+) + thinking activé — le stall **se reproduit** : le
> modèle annonce l'appel dans son raisonnement puis s'arrête sans l'émettre. Le
> [tool-call guard](../src/main/agent/hallucinated-toolcall-guard.ts) ne rattrape
> **pas** ce cas (aucun texte en forme de tool call à détecter). Mitigation livrée
> côté app : **thinking auto-désactivé sur les tours portant des outils** (voir §7).

---

## 1. Le symptôme (historique)

Certains modèles locaux (typiquement **Qwen3.x** servis via vLLM/llama.cpp, et
surtout **au-delà de ~32K de contexte**) émettent parfois un appel d'outil **en
texte** au lieu d'un appel structuré :

```
<tool_call>{"name": "read_file", "arguments": {...}}</tool_call>
<tool_call><function=read_file><parameter=path>...</parameter></function></tool_call>
```

…ou laissent l'appel **dans le flux de raisonnement**, où il n'est jamais exécuté.
Le tour se termine alors sans qu'aucun outil ne tourne, et l'agent se bloque
silencieusement (`finish_reason=stop` au lieu de `tool_calls`).

## 2. Cause racine

Ce n'est **pas** un mauvais choix de parser. Pour Qwen3.6, la configuration de ce
dépôt (`--reasoning-parser qwen3 --tool-call-parser qwen3_coder`) est bien celle
**recommandée officiellement** — le modèle émet le format XML `<function=…>`, que
`qwen3_coder` sait parser (vérifié dans le chat template du modèle).

La vraie cause est un bug **thinking ↔ tool** de la famille Qwen3.5/3.6 :

> Le modèle émet `<tool_call>` alors qu'il est **encore dans un bloc `<think>`
> non fermé** (il « oublie » le `</think>`). Le reasoning-parser avale alors tout
> l'appel dans `reasoning_content`, et `tool_calls` ressort **vide**.

Le phénomène est **intermittent** et s'aggrave à mesure que le contexte grandit
(blocs de raisonnement plus longs → `</think>` manquant plus fréquent). D'où le
« pire au-delà de 32K » observé historiquement.

## 3. Le correctif (côté serveur)

**vLLM ≥ 0.25.0** contient la
[PR #35687](https://github.com/vllm-project/vllm/pull/35687) — *« Treat
`<tool_call>` as implicit reasoning end in Qwen3 parser »* (mergée le 2026-04-24)
— qui traite `<tool_call>` comme une fin de raisonnement implicite, même sans
`</think>`. C'est ce qui referme le trou.

Défense en profondeur possible (non nécessaire sur le déploiement de référence) :
un **chat template corrigé** qui auto-ferme `<think>` avant `<tool_call>`, monté
via `--chat-template`.

### Config vLLM validée (déploiement de référence)

```bash
vllm serve /data/models/qwen3.6-27b-fp8 \
  --served-model-name qwen3.6-27b \
  --tensor-parallel-size 4 --max-model-len 131072 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice --tool-call-parser qwen3_coder \  # reco officielle Qwen3.6
  --default-chat-template-kwargs '{"enable_thinking": true, "preserve_thinking": true}' \
  --kv-cache-dtype fp8_e4m3 --attention-backend flashinfer \
  --enable-prefix-caching --enable-chunked-prefill \
  --host 0.0.0.0 --port 8000 --api-key "$VLLM_API_KEY"
```

> [!NOTE]
> Ne pas coder la clé API en dur — la passer par variable d'environnement.
> Adapter chemins / GPU au serveur cible.

## 4. Le tool-call guard côté app

[`src/main/agent/hallucinated-toolcall-guard.ts`](../src/main/agent/hallucinated-toolcall-guard.ts)
inspecte chaque tour d'assistant qui se termine **sans** appel structuré ; s'il
détecte un fragment en forme de tool call (`<tool_call>`, `<function=…>`,
`<function_call>`, `<tool_use>`) dans le texte — ou, pour les tours sans texte
visible, dans le raisonnement — il recadre le modèle pour qu'il réémette l'appel
via le vrai mécanisme (`maxSteersPerRun = 2`).

Depuis vLLM 0.25.0, ce guard **ne rattrape plus de bug vivant** sur le déploiement
de référence : c'est une **ceinture-bretelles** qui couvre les cas extrêmes
(contexte très profond, autre modèle/endpoint, régression future).

> [!TIP]
> Logger `steersIssued` par run pour transformer cette hypothèse en métrique :
> un compteur qui reste à zéro en usage réel = preuve que le serving est sain ;
> s'il grimpe, ce sont **ces cas précis** qu'il faut ré-auditer (voir §5).

## 5. Test de non-régression

À relancer après un upgrade vLLM, un changement de modèle, ou si le guard commence
à logger des déclenchements. Lecture seule ; nécessite `curl` + `python3` sur une
machine qui atteint l'endpoint.

```bash
#!/usr/bin/env bash
# Non-régression tool-calling Qwen3.x / vLLM — lecture seule.
set -uo pipefail
VLLM_URL="${VLLM_URL:-http://localhost:8000}"; API="$VLLM_URL/v1"
KEY="${VLLM_API_KEY:-changeme}"; MODEL="${MODEL:-qwen3.6-27b}"
AUTH="Authorization: Bearer $KEY"; JSON="Content-Type: application/json"
TOOLS='[{"type":"function","function":{"name":"get_weather","description":"Meteo dune ville","parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}]'

verdict() { python3 -c '
import sys,json
r=json.loads(sys.stdin.read())
if isinstance(r,dict) and r.get("error"): print("  [api-error]",str(r["error"])[:140]); raise SystemExit
ch=(r.get("choices") or [{}])[0]; m=ch.get("message",{}) or {}; fr=ch.get("finish_reason")
tc=m.get("tool_calls"); c=(m.get("content") or "").strip(); rc=(m.get("reasoning_content") or "").strip()
pt=(r.get("usage") or {}).get("prompt_tokens")
if tc: print(f"  [OK structured] ctx={pt} finish={fr}")
elif "<function=" in c+rc or "<tool_call>" in c+rc: print(f"  [FUITE] ctx={pt} finish={fr} ->",(c or rc)[:110].replace(chr(10)," "))
elif fr=="length": print(f"  [TRONQUE] ctx={pt} (monte max_tokens)")
else: print(f"  [pas dappel] ctx={pt} finish={fr} ->",(c[:80] or "think:"+rc[:70]).replace(chr(10)," "))
'; }

echo "### Court — thinking OFF, temp 0"
curl -s --max-time 120 "$API/chat/completions" -H "$AUTH" -H "$JSON" -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"Quelle meteo a Paris ? Appelle get_weather."}],"tools":'"$TOOLS"',"tool_choice":"auto","temperature":0,"max_tokens":512,"chat_template_kwargs":{"enable_thinking":false}}' | verdict

echo "### Court — thinking ON, temp 1.0 (x3)"
for i in 1 2 3; do
  curl -s --max-time 120 "$API/chat/completions" -H "$AUTH" -H "$JSON" -d '{"model":"'"$MODEL"'","messages":[{"role":"user","content":"Quelle meteo a Paris ? Appelle get_weather."}],"tools":'"$TOOLS"',"tool_choice":"auto","temperature":1.0,"max_tokens":1024}' | verdict
done

echo "### Contexte profond (~64K) — thinking ON, temp 1.0 (x5)"
BF="$(mktemp)"
python3 - "$MODEL" "$TOOLS" > "$BF" <<'PY'
import sys,json
model,tools=sys.argv[1],json.loads(sys.argv[2])
line="Bloc {n}: le pipeline documentaire valide, indexe et archive chaque enregistrement, journalise les erreurs et applique une politique de reprise sur incident specifique. "
filler="".join(line.format(n=n) for n in range(1800))
req={"model":model,"messages":[{"role":"user","content":"Document technique a conserver en contexte:\n\n"+filler+"\n\nConsigne: reflechis etape par etape, PUIS tu DOIS appeler get_weather pour Paris."}],"tools":tools,"tool_choice":"auto","temperature":1.0,"max_tokens":2048}
json.dump(req,sys.stdout)
PY
for i in 1 2 3 4 5; do
  curl -s --max-time 300 "$API/chat/completions" -H "$AUTH" -H "$JSON" --data @"$BF" | verdict
done
rm -f "$BF"
```

> [!NOTE]
> Si la ligne « contexte profond » affiche `ctx=` **< 32000**, augmenter le
> `range(1800)` (p. ex. `range(3000)`) : il faut dépasser ~32K pour solliciter le
> bug historique. `--enable-prefix-caching` rend les tirs 2→5 rapides (prompt
> identique mis en cache).

### Résultat de référence (2026-07-24, vLLM 0.25.0, `qwen3.6-27b-fp8`)

| Condition | Contexte | Résultat |
| --- | --- | --- |
| thinking off, temp 0 | court | `[OK structured]` |
| thinking on, temp 1.0, ×3 | court | 3/3 `[OK structured]` |
| thinking on, temp 1.0, ×5 | **64 107 tokens** | **5/5 `finish=tool_calls`** |

## 6. Quand ré-auditer

- Après tout **upgrade / downgrade vLLM** (parsers et reasoning-parser évoluent vite).
- Après un **changement de modèle** ou de chat template.
- Si le **guard** se met à logger des `steersIssued > 0` récurrents.
- Avant d'incriminer l'app : le tool-calling local est d'abord un problème de
  **serving** (parser + chat template + version), pas d'architecture agent.

## 7. Mitigation applicative : thinking auto-désactivé sur les tours à outils

Le test de non-régression du §5 (1 outil, contexte court) passait 5/5 — mais **en
agentique réel** (beaucoup d'outils MCP + contexte profond + thinking activé) le
stall se reproduit : le modèle annonce l'appel dans son raisonnement puis s'arrête
sans jamais l'émettre. Le tool-call guard ne le voit pas (pas de texte en forme de
tool call à détecter).

Puisque le raisonnement n'apporte rien à la **sélection** d'outil et que le bug
n'existe **que** s'il y a un bloc `<think>`, l'app désactive désormais le thinking
sur toute requête portant des outils, via le hook `before_provider_request` :

- Fichier : [`src/main/agent/thinking-tool-guard.ts`](../src/main/agent/thinking-tool-guard.ts)
  — force `chat_template_kwargs.enable_thinking=false` dès que `payload.tools` est
  non vide (fusion, sans écraser `preserve_thinking`). Cela **prime aussi** un
  `--default-chat-template-kwargs {"enable_thinking": true}` côté serveur.
- **Portée** : uniquement le rail Qwen chat-template (vLLM/SGLang), détecté par
  `modelUsesQwenChatTemplateThinking` (`pi-model-resolution.ts`). Anthropic, Ollama
  (`reasoning_effort`) et DeepSeek ne sont jamais touchés.
- **Conséquence** : le raisonnement reste actif en chat **sans** outils ; il est
  coupé sur les tours agentiques (où il est de toute façon un risque, pas un gain).

Alternative si tu veux garder thinking **et** outils ensemble : le `--chat-template`
corrigé qui auto-ferme `<think>` avant `<tool_call>` (§3, défense côté serveur).
Les deux sont compatibles.

## Références

- [vLLM PR #35687 — implicit reasoning end (fix)](https://github.com/vllm-project/vllm/pull/35687)
- [vLLM #39056 — Qwen3.5 perd les tool calls émis dans `<think>`](https://github.com/vllm-project/vllm/issues/39056)
- [QwenLM/Qwen3.6 #150 — empty tool call](https://github.com/QwenLM/Qwen3.6/issues/150)
- [vLLM recipe — Qwen3.6-27B](https://recipes.vllm.ai/Qwen/Qwen3.6-27B)
- [tfriedel — Qwen3.6 tool calling issues & fixes](https://github.com/tfriedel/qwen3.6-rtx3090-lab/blob/main/TOOL_CALLING_ISSUES.md)
