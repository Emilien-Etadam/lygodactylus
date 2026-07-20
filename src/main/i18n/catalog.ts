// Main-process (backend) localization catalog.
//
// Strings follow the user's chosen UI language (mirrored from the renderer as
// `uiLanguage`). English (`en`) is only the ultimate fallback when the locale
// is missing/unknown (see ./index.ts). The keys below cover backend strings
// that surface directly in the UI: model/network errors, MCP/tool failures,
// scheduled-task titles, the startup-failure dialog, and the default config-set name.
//
// Placeholders use the {{name}} syntax and are interpolated by mt(); `\n`
// produces a real newline at runtime, and leading/trailing underscores are
// markdown italics rendered by the chat view.

export type BackendMessageKey =
  | 'errModelTimeout'
  | 'errRequestTimeout'
  | 'errSessionSetupTimeout'
  | 'errEmptySuccess'
  | 'errContextOverflow'
  | 'errBadRequest'
  | 'errAuthFailed'
  | 'errRateLimited'
  | 'errUpstreamError'
  | 'errNetworkInterrupted'
  | 'errCheckConfigHint'
  | 'errRetryingHint'
  | 'errContextCompactionHint'
  | 'errConfigRequired'
  | 'noticeCompactionStart'
  | 'noticeCompactionFailed'
  | 'noticeCompactionCompleted'
  | 'noticeHandoffStart'
  | 'noticeHandoffFailed'
  | 'errUnknownSlashCommand'
  | 'errPresetSlashClientOnly'
  | 'startupFailedTitle'
  | 'startupFailedBody'
  | 'configDefaultSetName'
  | 'configFallbackSetName'
  | 'errFetchTimeout'
  | 'errChromeNotReady'
  | 'errNodeRuntimeUnavailable'
  | 'hintMacosScreenRecording'
  | 'hintMacosAccessibility'
  | 'hintMacosAccessibilityAutomation'
  | 'scheduleTitlePrefix'
  | 'scheduleEmptyTitle'
  | 'traceRequestTimedOut'
  | 'atMentionNoWorkspace'
  | 'atMentionPathEscapesWorkspace'
  | 'atMentionPathMissing'
  | 'atMentionPathUnsupported'
  | 'atMentionDirectoryEmpty'
  | 'atMentionDirectoryFailed'
  | 'atMentionFileTruncated'
  | 'atMentionFileFailed'
  | 'atMentionUrlFailed'
  | 'checkpointRestoreInvalidArgs'
  | 'checkpointRestoreRunInProgress'
  | 'checkpointRestoreNotFound'
  | 'checkpointRestoreFailed'
  | 'errPiiScrubFailed';

export type BackendMessages = Record<BackendMessageKey, string>;

export const SUPPORTED_BACKEND_LANGUAGES = [
  'en',
  'zh',
  'es',
  'fr',
  'de',
  'it',
  'uk',
  'pl',
  'sv',
  'no',
  'nl',
  'ro',
] as const;

export const DEFAULT_BACKEND_LANGUAGE = 'en';

export const backendCatalog: Record<string, BackendMessages> = {
  zh: {
    errModelTimeout: '模型响应超时：长时间未收到上游返回，请稍后重试或检查当前模型/网关负载。',
    errRequestTimeout: '**请求超时**：长时间未收到响应，操作已中止。',
    errSessionSetupTimeout:
      '会话准备超时（超过 3 分钟）。常见原因：首次下载 Node/Python 运行时、插件/技能加载过慢、或记忆检索耗时过长。请稍后重试；若持续出现，可暂时关闭记忆或减少已启用插件。',
    errEmptySuccess:
      '模型返回了一个空的成功结果，当前模型或网关兼容性可能有问题，请重试或切换协议后再试。',
    errContextOverflow:
      '对话上下文已满。请开始新的对话，或减少消息长度，或在 API 设置中降低最大输出 tokens。（限制：{{limit}} tokens，已用：{{input}} input + {{output}} output）',
    errBadRequest:
      '请求被上游拒绝（400），可能是模型/协议配置不兼容。请检查模型名称、协议设置和 API 端点。\n原始错误: {{error}}',
    errAuthFailed:
      '认证失败，请检查 API Key 是否正确、是否已过期或无权访问当前模型。\n原始错误: {{error}}',
    errRateLimited:
      '请求被限流（429），当前模型或 API 端点的调用频率已达上限，请稍后重试。\n原始错误: {{error}}',
    errUpstreamError:
      '上游服务异常，可能是模型服务过载或临时故障，SDK 将自动重试。\n原始错误: {{error}}',
    errNetworkInterrupted: '网络连接中断（{{error}}），可能是代理/网关不稳定，SDK 将自动重试。',
    errCheckConfigHint: '_请检查配置后重试。_',
    errRetryingHint: '_Agent 正在自动重试，请稍候..._',
    errContextCompactionHint: '_上下文已满。正在自动压缩，或使用 /compact 释放空间。_',
    errConfigRequired: '当前方案未配置可用凭证，请先在 API 设置中完成配置',
    noticeCompactionStart: '正在压缩对话上下文以释放空间...',
    noticeCompactionFailed: '上下文压缩失败：{{error}}',
    noticeCompactionCompleted: '上下文压缩完成，正在继续处理请求。',
    noticeHandoffStart: '正在总结当前对话，以便在新会话中继续…',
    noticeHandoffFailed: '会话交接失败：{{error}}',
    errUnknownSlashCommand: '未知斜杠命令：{{command}}',
    errPresetSlashClientOnly: '提示词预设只能在聊天输入框中使用（/preset），不能作为服务端提示运行：{{command}}',
    startupFailedTitle: 'Lygodactylus 启动失败',
    startupFailedBody: '{{message}}\n\n请查看日志获取更多信息。',
    configDefaultSetName: '默认方案',
    configFallbackSetName: '方案 {{index}}',
    errFetchTimeout: '请求超时，请检查网络连接后重试',
    errChromeNotReady: 'Chrome 浏览器未就绪，无法执行此操作: {{detail}}',
    errNodeRuntimeUnavailable:
      'Node.js 运行时暂不可用，首次使用 MCP 时将自动下载。\n\n请连接网络后重试启动 MCP 服务器。',
    hintMacosScreenRecording:
      '\n\nmacOS 权限提示：\n- 系统设置 → 隐私与安全性 → 屏幕录制：允许 Lygodactylus\n- 重新启动应用后再试\n',
    hintMacosAccessibility:
      '\n\nmacOS 权限提示：\n- 系统设置 → 隐私与安全性 → 辅助功能：允许 Lygodactylus\n- 如果是终端运行：允许 Terminal/iTerm\n- 授权后请重启 Lygodactylus 再重试\n',
    hintMacosAccessibilityAutomation:
      '\n\nmacOS 权限提示：\n- 系统设置 → 隐私与安全性 → 辅助功能：允许 Lygodactylus\n- 系统设置 → 隐私与安全性 → 自动化：允许 Lygodactylus 控制 “System Events”\n',
    scheduleTitlePrefix: '[定时任务]',
    scheduleEmptyTitle: '未命名任务',
    traceRequestTimedOut: '请求超时',
    atMentionNoWorkspace: '没有可用的工作区，无法解析 @ 提及。',
    atMentionPathEscapesWorkspace: '路径超出工作区范围，已忽略：{{path}}',
    atMentionPathMissing: '文件或目录不存在：{{path}}',
    atMentionPathUnsupported: '不支持的路径类型：{{path}}',
    atMentionDirectoryEmpty: '目录为空：{{path}}',
    atMentionDirectoryFailed: '无法列出目录 {{path}}：{{error}}',
    atMentionFileTruncated: '[已截断：仅包含前 {{limit}} 字节，原文件 {{size}} 字节]',
    atMentionFileFailed: '无法读取文件 {{path}}：{{error}}',
    atMentionUrlFailed: '无法获取 URL {{url}}：{{error}}',
    checkpointRestoreInvalidArgs: '撤销参数无效。',
    checkpointRestoreRunInProgress: '当前会话仍有正在运行的任务，无法撤销此运行。',
    checkpointRestoreNotFound: '找不到此运行的检查点。',
    checkpointRestoreFailed: '撤销此运行的更改失败。',
    errPiiScrubFailed: '出站调用前的个人数据脱敏失败；调用已阻止（故障封闭）。',
  },
  en: {
    errModelTimeout:
      'Model response timed out: no reply from the upstream service for a while. Please retry later or check the current model/gateway load.',
    errRequestTimeout:
      '**Request timed out**: No response received for a long time. The operation was aborted.',
    errSessionSetupTimeout:
      'Session setup timed out (over 3 minutes). Common causes: first-time Node/Python runtime download, slow plugin/skill loading, or slow memory retrieval. Retry shortly; if it persists, temporarily disable memory or reduce enabled plugins.',
    errEmptySuccess:
      'The model returned an empty successful result. The current model or gateway may have a compatibility issue — please retry or switch protocol and try again.',
    errContextOverflow:
      'The conversation context is full. Start a new conversation, shorten your messages, or lower max output tokens in API Settings. (Limit: {{limit}} tokens, used: {{input}} input + {{output}} output)',
    errBadRequest:
      'The request was rejected upstream (400). The model/protocol configuration may be incompatible. Please check the model name, protocol settings and API endpoint.\nOriginal error: {{error}}',
    errAuthFailed:
      'Authentication failed. Please check whether the API Key is correct, has expired, or lacks access to the current model.\nOriginal error: {{error}}',
    errRateLimited:
      'The request was rate limited (429). The current model or API endpoint has reached its call-rate limit. Please retry later.\nOriginal error: {{error}}',
    errUpstreamError:
      'The upstream service returned an error — the model service may be overloaded or temporarily unavailable. The SDK will retry automatically.\nOriginal error: {{error}}',
    errNetworkInterrupted:
      'The network connection was interrupted ({{error}}). The proxy/gateway may be unstable. The SDK will retry automatically.',
    errCheckConfigHint: '_Please check your configuration and retry._',
    errRetryingHint: '_The agent is retrying automatically, please wait..._',
    errContextCompactionHint:
      '_Context is full. Compacting automatically, or use /compact to free space._',
    errConfigRequired:
      'The current configuration set has no usable credentials. Please complete the setup in API Settings first.',
    noticeCompactionStart: 'Compacting conversation context to free space...',
    noticeCompactionFailed: 'Context compaction failed: {{error}}',
    noticeCompactionCompleted: 'Context compaction completed. Continuing the request.',
    noticeHandoffStart: 'Summarizing this conversation for a new session…',
    noticeHandoffFailed: 'Session handoff failed: {{error}}',
    errUnknownSlashCommand: 'Unknown slash command: {{command}}',
    errPresetSlashClientOnly: 'Prompt presets can only be used from the chat input (/preset), not as a server-side prompt: {{command}}',
    startupFailedTitle: 'Lygodactylus failed to start',
    startupFailedBody: '{{message}}\n\nPlease check the logs for more information.',
    configDefaultSetName: 'Default',
    configFallbackSetName: 'Configuration {{index}}',
    errFetchTimeout: 'Request timed out. Check your network connection and try again.',
    errChromeNotReady: 'Chrome browser is not ready, cannot perform this action: {{detail}}',
    errNodeRuntimeUnavailable:
      'Node.js runtime is not available yet. The app will download it on first MCP use.\n\nConnect to the internet and retry opening MCP servers.',
    hintMacosScreenRecording:
      '\n\nmacOS permissions hint:\n- System Settings → Privacy & Security → Screen Recording: allow Lygodactylus\n- Restart the app and try again\n',
    hintMacosAccessibility:
      '\n\nmacOS permissions hint:\n- System Settings → Privacy & Security → Accessibility: allow Lygodactylus\n- If launched from a terminal: allow Terminal/iTerm\n- After granting permission, restart Lygodactylus and try again\n',
    hintMacosAccessibilityAutomation:
      '\n\nmacOS permissions hint:\n- System Settings → Privacy & Security → Accessibility: allow Lygodactylus\n- System Settings → Privacy & Security → Automation: allow Lygodactylus to control “System Events”\n',
    scheduleTitlePrefix: '[Scheduled Task]',
    scheduleEmptyTitle: 'Untitled task',
    traceRequestTimedOut: 'Request timed out',
    atMentionNoWorkspace: 'No workspace is available; @ mention could not be resolved.',
    atMentionPathEscapesWorkspace: 'Path escapes the workspace and was ignored: {{path}}',
    atMentionPathMissing: 'File or directory not found: {{path}}',
    atMentionPathUnsupported: 'Unsupported path type: {{path}}',
    atMentionDirectoryEmpty: 'Directory is empty: {{path}}',
    atMentionDirectoryFailed: 'Could not list directory {{path}}: {{error}}',
    atMentionFileTruncated: '[Truncated: first {{limit}} bytes of {{size}}]',
    atMentionFileFailed: 'Could not read file {{path}}: {{error}}',
    atMentionUrlFailed: 'Could not fetch URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Invalid undo arguments.',
    checkpointRestoreRunInProgress: 'A run is still in progress on this session; cannot undo.',
    checkpointRestoreNotFound: 'No checkpoint found for this run.',
    checkpointRestoreFailed: 'Failed to undo changes from this run.',
    errPiiScrubFailed: 'Personal data masking failed before the outbound call; the call was blocked (fail-closed).',
  },
  es: {
    errModelTimeout:
      'Se agotó el tiempo de espera de la respuesta del modelo: el servicio remoto no respondió durante un rato. Vuelve a intentarlo más tarde o revisa la carga actual del modelo o la pasarela.',
    errRequestTimeout:
      '**Tiempo de espera agotado**: No se recibió respuesta durante mucho tiempo. La operación se canceló.',
    errSessionSetupTimeout:
      'La preparación de la sesión expiró (más de 3 minutos). Causas habituales: descarga inicial de runtimes Node/Python, carga lenta de plugins/skills o recuperación de memoria lenta. Reintenta en un momento; si persiste, desactiva temporalmente la memoria o reduce los plugins activos.',
    errEmptySuccess:
      'El modelo devolvió un resultado correcto pero vacío. Es posible que el modelo o la pasarela actual tengan un problema de compatibilidad; vuelve a intentarlo o cambia de protocolo e inténtalo de nuevo.',
    errContextOverflow:
      'El contexto de la conversación está lleno. Inicia una conversación nueva, acorta los mensajes o reduce los tokens máximos de salida en los Ajustes de la API. (Límite: {{limit}} tokens, usado: {{input}} input + {{output}} output)',
    errBadRequest:
      'El servicio remoto rechazó la solicitud (400). Puede que la configuración del modelo o el protocolo sea incompatible. Comprueba el nombre del modelo, los ajustes del protocolo y el endpoint de la API.\nError original: {{error}}',
    errAuthFailed:
      'Error de autenticación. Comprueba si la API Key es correcta, ha caducado o no tiene acceso al modelo actual.\nError original: {{error}}',
    errRateLimited:
      'Se limitó la frecuencia de la solicitud (429). El modelo o el endpoint de la API actual alcanzó su límite de frecuencia de llamadas. Vuelve a intentarlo más tarde.\nError original: {{error}}',
    errUpstreamError:
      'El servicio remoto devolvió un error: puede que el servicio del modelo esté sobrecargado o no esté disponible temporalmente. El SDK reintentará automáticamente.\nError original: {{error}}',
    errNetworkInterrupted:
      'Se interrumpió la conexión de red ({{error}}). Puede que el proxy o la pasarela sean inestables. El SDK reintentará automáticamente.',
    errCheckConfigHint: '_Comprueba tu configuración y vuelve a intentarlo._',
    errRetryingHint: '_El agente está reintentando automáticamente, espera un momento..._',
    errContextCompactionHint:
      '_El contexto está lleno. Comprimiendo automáticamente, o usa /compact para liberar espacio._',
    errConfigRequired:
      'El conjunto de configuración actual no tiene credenciales utilizables. Completa primero la configuración en los Ajustes de la API.',
    noticeCompactionStart: 'Compactando el contexto de la conversación para liberar espacio...',
    noticeCompactionFailed: 'Error al compactar el contexto: {{error}}',
    noticeCompactionCompleted: 'Compactación del contexto completada. Continuando la solicitud.',
    noticeHandoffStart: 'Resumiendo esta conversación para una nueva sesión…',
    noticeHandoffFailed: 'Error al transferir la sesión: {{error}}',
    errUnknownSlashCommand: 'Comando desconocido: {{command}}',
    errPresetSlashClientOnly: 'Los presets de prompts solo se pueden usar desde la entrada del chat (/preset), no como prompt del servidor: {{command}}',
    startupFailedTitle: 'No se pudo iniciar Lygodactylus',
    startupFailedBody: '{{message}}\n\nConsulta los registros para obtener más información.',
    configDefaultSetName: 'Predeterminada',
    configFallbackSetName: 'Configuración {{index}}',
    errFetchTimeout: 'Se agotó el tiempo de espera. Comprueba tu conexión de red e inténtalo de nuevo.',
    errChromeNotReady: 'El navegador Chrome no está listo; no se puede realizar esta acción: {{detail}}',
    errNodeRuntimeUnavailable:
      'El runtime de Node.js aún no está disponible. La aplicación lo descargará en el primer uso de MCP.\n\nConéctate a Internet e intenta abrir de nuevo los servidores MCP.',
    hintMacosScreenRecording:
      '\n\nAviso de permisos de macOS:\n- Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla: permitir Lygodactylus\n- Reinicia la aplicación e inténtalo de nuevo\n',
    hintMacosAccessibility:
      '\n\nAviso de permisos de macOS:\n- Ajustes del Sistema → Privacidad y seguridad → Accesibilidad: permitir Lygodactylus\n- Si se lanza desde un terminal: permitir Terminal/iTerm\n- Tras conceder el permiso, reinicia Lygodactylus e inténtalo de nuevo\n',
    hintMacosAccessibilityAutomation:
      '\n\nAviso de permisos de macOS:\n- Ajustes del Sistema → Privacidad y seguridad → Accesibilidad: permitir Lygodactylus\n- Ajustes del Sistema → Privacidad y seguridad → Automatización: permitir que Lygodactylus controle “System Events”\n',
    scheduleTitlePrefix: '[Tarea programada]',
    scheduleEmptyTitle: 'Tarea sin nombre',
    traceRequestTimedOut: 'Tiempo de espera agotado',
    atMentionNoWorkspace: 'No hay un espacio de trabajo disponible; no se pudo resolver la mención @.',
    atMentionPathEscapesWorkspace: 'La ruta sale del espacio de trabajo y se ignoró: {{path}}',
    atMentionPathMissing: 'Archivo o directorio no encontrado: {{path}}',
    atMentionPathUnsupported: 'Tipo de ruta no compatible: {{path}}',
    atMentionDirectoryEmpty: 'El directorio está vacío: {{path}}',
    atMentionDirectoryFailed: 'No se pudo listar el directorio {{path}}: {{error}}',
    atMentionFileTruncated: '[Truncado: primeros {{limit}} bytes de {{size}}]',
    atMentionFileFailed: 'No se pudo leer el archivo {{path}}: {{error}}',
    atMentionUrlFailed: 'No se pudo obtener la URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Argumentos de deshacer no válidos.',
    checkpointRestoreRunInProgress: 'Todavía hay una ejecución en curso en esta sesión; no se puede deshacer.',
    checkpointRestoreNotFound: 'No se encontró ningún punto de control para esta ejecución.',
    checkpointRestoreFailed: 'No se pudieron deshacer los cambios de esta ejecución.',
    errPiiScrubFailed: 'Falló el enmascaramiento de datos personales antes de la llamada saliente; la llamada se bloqueó (fail-closed).',
  },
  fr: {
    errModelTimeout:
      "Le délai d'attente de la réponse du modèle a expiré : aucune réponse du service en amont depuis un certain temps. Veuillez réessayer plus tard ou vérifier la charge actuelle du modèle ou de la passerelle.",
    errRequestTimeout:
      '**Délai dépassé** : aucune réponse reçue depuis longtemps, l’opération a été interrompue.',
    errSessionSetupTimeout:
      "La préparation de la session a expiré (plus de 3 minutes). Causes fréquentes : téléchargement initial des runtimes Node/Python, chargement lent des plugins/skills, ou recherche mémoire trop longue. Réessayez dans un instant ; si le problème persiste, désactivez temporairement la mémoire ou réduisez les plugins actifs.",
    errEmptySuccess:
      'Le modèle a renvoyé un résultat vide alors que la requête a abouti. Le modèle ou la passerelle actuels présentent peut-être un problème de compatibilité — veuillez réessayer ou changer de protocole, puis recommencer.',
    errContextOverflow:
      "Le contexte de la conversation est plein. Démarrez une nouvelle conversation, réduisez la taille des messages ou diminuez les tokens de sortie maximaux dans les Paramètres de l'API. (Limite : {{limit}} tokens, utilisé : {{input}} input + {{output}} output)",
    errBadRequest:
      "La requête a été rejetée en amont (400). La configuration du modèle ou du protocole est peut-être incompatible. Veuillez vérifier le nom du modèle, les paramètres du protocole et le point de terminaison de l'API.\nErreur d'origine : {{error}}",
    errAuthFailed:
      "Échec de l'authentification. Veuillez vérifier si l'API Key est correcte, si elle a expiré ou si elle n'a pas accès au modèle actuel.\nErreur d'origine : {{error}}",
    errRateLimited:
      "La requête a été limitée en débit (429). Le modèle ou le point de terminaison de l'API actuels ont atteint leur limite de fréquence d'appels. Veuillez réessayer plus tard.\nErreur d'origine : {{error}}",
    errUpstreamError:
      "Le service en amont a renvoyé une erreur — le service du modèle est peut-être surchargé ou temporairement indisponible. Le SDK réessaiera automatiquement.\nErreur d'origine : {{error}}",
    errNetworkInterrupted:
      'La connexion réseau a été interrompue ({{error}}). Le proxy ou la passerelle sont peut-être instables. Le SDK réessaiera automatiquement.',
    errCheckConfigHint: '_Veuillez vérifier votre configuration et réessayer._',
    errRetryingHint: "_L'agent réessaie automatiquement, veuillez patienter..._",
    errContextCompactionHint:
      '_Contexte plein. Compression automatique en cours, ou utilisez /compact pour libérer de l’espace._',
    errConfigRequired:
      "Le jeu de configuration actuel ne contient aucun identifiant utilisable. Veuillez d'abord finaliser la configuration dans les Paramètres de l'API.",
    noticeCompactionStart: 'Compaction du contexte de la conversation en cours...',
    noticeCompactionFailed: 'Échec de la compaction du contexte : {{error}}',
    noticeCompactionCompleted: 'Compaction du contexte terminée. Poursuite de la requête.',
    noticeHandoffStart: 'Résumé de la conversation en cours pour une nouvelle session…',
    noticeHandoffFailed: 'Échec de la reprise de session : {{error}}',
    errUnknownSlashCommand: 'Commande slash inconnue : {{command}}',
    errPresetSlashClientOnly: 'Les presets de prompts ne sont utilisables que depuis la zone de saisie (/preset), pas comme prompt côté serveur : {{command}}',
    startupFailedTitle: "Échec du démarrage d'Lygodactylus",
    startupFailedBody: '{{message}}\n\nVeuillez consulter les journaux pour plus d’informations.',
    configDefaultSetName: 'Par défaut',
    configFallbackSetName: 'Configuration {{index}}',
    errFetchTimeout: "Délai d'attente dépassé. Vérifiez votre connexion réseau puis réessayez.",
    errChromeNotReady: "Le navigateur Chrome n'est pas prêt, impossible d'effectuer cette opération : {{detail}}",
    errNodeRuntimeUnavailable:
      "Le runtime Node.js n'est pas encore disponible. L'application le téléchargera lors de la première utilisation de MCP.\n\nConnectez-vous à Internet puis réessayez d'ouvrir les serveurs MCP.",
    hintMacosScreenRecording:
      '\n\nConseil permissions macOS :\n- Réglages Système → Confidentialité et sécurité → Enregistrement de l’écran : autoriser Lygodactylus\n- Redémarrez l’application puis réessayez\n',
    hintMacosAccessibility:
      '\n\nConseil permissions macOS :\n- Réglages Système → Confidentialité et sécurité → Accessibilité : autoriser Lygodactylus\n- Si lancé depuis un terminal : autoriser Terminal/iTerm\n- Après l’autorisation, redémarrez Lygodactylus puis réessayez\n',
    hintMacosAccessibilityAutomation:
      '\n\nConseil permissions macOS :\n- Réglages Système → Confidentialité et sécurité → Accessibilité : autoriser Lygodactylus\n- Réglages Système → Confidentialité et sécurité → Automatisation : autoriser Lygodactylus à contrôler “System Events”\n',
    scheduleTitlePrefix: '[Tâche planifiée]',
    scheduleEmptyTitle: 'Tâche sans nom',
    traceRequestTimedOut: 'Délai dépassé',
    atMentionNoWorkspace: 'Aucun espace de travail disponible ; la mention @ n’a pas pu être résolue.',
    atMentionPathEscapesWorkspace: 'Chemin hors de l’espace de travail, ignoré : {{path}}',
    atMentionPathMissing: 'Fichier ou dossier introuvable : {{path}}',
    atMentionPathUnsupported: 'Type de chemin non pris en charge : {{path}}',
    atMentionDirectoryEmpty: 'Dossier vide : {{path}}',
    atMentionDirectoryFailed: 'Impossible de lister le dossier {{path}} : {{error}}',
    atMentionFileTruncated: '[Tronqué : {{limit}} premiers octets sur {{size}}]',
    atMentionFileFailed: 'Impossible de lire le fichier {{path}} : {{error}}',
    atMentionUrlFailed: 'Impossible de récupérer l’URL {{url}} : {{error}}',
    checkpointRestoreInvalidArgs: 'Arguments d\'annulation invalides.',
    checkpointRestoreRunInProgress: 'Une exécution est encore en cours sur cette session ; annulation impossible.',
    checkpointRestoreNotFound: 'Aucun point de contrôle trouvé pour ce run.',
    checkpointRestoreFailed: 'Échec de l\'annulation des changements de ce run.',
    errPiiScrubFailed: 'Échec du masquage des données personnelles avant l\'appel sortant ; l\'appel a été bloqué (fail-closed).',
  },
  de: {
    errModelTimeout:
      'Zeitüberschreitung bei der Modellantwort: Der vorgelagerte Dienst hat längere Zeit nicht reagiert. Bitte versuchen Sie es später erneut oder prüfen Sie die aktuelle Auslastung von Modell/Gateway.',
    errRequestTimeout:
      '**Zeitüberschreitung**: Längere Zeit keine Antwort erhalten. Der Vorgang wurde abgebrochen.',
    errSessionSetupTimeout:
      'Die Sitzungsvorbereitung ist abgelaufen (über 3 Minuten). Häufige Ursachen: erstmaliger Download der Node/Python-Runtimes, langsames Laden von Plugins/Skills oder langsame Speicherabfrage. Bitte kurz warten und erneut versuchen; falls es anhält, Speicher vorübergehend deaktivieren oder weniger Plugins aktivieren.',
    errEmptySuccess:
      'Das Modell hat ein leeres, aber erfolgreiches Ergebnis zurückgegeben. Möglicherweise besteht ein Kompatibilitätsproblem mit dem aktuellen Modell oder Gateway – bitte versuchen Sie es erneut oder wechseln Sie das Protokoll.',
    errContextOverflow:
      'Der Gesprächskontext ist voll. Starten Sie eine neue Unterhaltung, kürzen Sie Nachrichten oder verringern Sie die maximalen Ausgabe-Tokens in den API-Einstellungen. (Limit: {{limit}} Tokens, genutzt: {{input}} input + {{output}} output)',
    errBadRequest:
      'Die Anfrage wurde vorgelagert abgelehnt (400). Die Konfiguration von Modell/Protokoll ist möglicherweise inkompatibel. Bitte prüfen Sie Modellname, Protokolleinstellungen und API-Endpunkt.\nUrsprünglicher Fehler: {{error}}',
    errAuthFailed:
      'Authentifizierung fehlgeschlagen. Bitte prüfen Sie, ob der API Key korrekt ist, abgelaufen ist oder keinen Zugriff auf das aktuelle Modell hat.\nUrsprünglicher Fehler: {{error}}',
    errRateLimited:
      'Die Anfrage wurde wegen einer Ratenbegrenzung abgelehnt (429). Das aktuelle Modell oder der API-Endpunkt hat sein Aufruflimit erreicht. Bitte versuchen Sie es später erneut.\nUrsprünglicher Fehler: {{error}}',
    errUpstreamError:
      'Der vorgelagerte Dienst hat einen Fehler zurückgegeben – der Modelldienst ist möglicherweise überlastet oder vorübergehend nicht verfügbar. Das SDK wiederholt den Vorgang automatisch.\nUrsprünglicher Fehler: {{error}}',
    errNetworkInterrupted:
      'Die Netzwerkverbindung wurde unterbrochen ({{error}}). Möglicherweise ist der Proxy bzw. das Gateway instabil. Das SDK wiederholt den Vorgang automatisch.',
    errCheckConfigHint: '_Bitte überprüfen Sie Ihre Konfiguration und versuchen Sie es erneut._',
    errRetryingHint: '_Der Agent wiederholt den Vorgang automatisch, bitte warten ..._',
    errContextCompactionHint:
      '_Kontext voll. Automatische Komprimierung läuft, oder verwenden Sie /compact, um Platz zu schaffen._',
    errConfigRequired:
      'Der aktuelle Konfigurationssatz enthält keine verwendbaren Anmeldedaten. Bitte schließen Sie zunächst die Einrichtung in den API-Einstellungen ab.',
    noticeCompactionStart: 'Gesprächskontext wird komprimiert, um Speicher freizugeben...',
    noticeCompactionFailed: 'Kontextkomprimierung fehlgeschlagen: {{error}}',
    noticeCompactionCompleted: 'Kontextkomprimierung abgeschlossen. Anfrage wird fortgesetzt.',
    noticeHandoffStart: 'Diese Unterhaltung wird für eine neue Sitzung zusammengefasst…',
    noticeHandoffFailed: 'Sitzungsübergabe fehlgeschlagen: {{error}}',
    errUnknownSlashCommand: 'Unbekannter Slash-Befehl: {{command}}',
    errPresetSlashClientOnly: 'Prompt-Presets können nur über die Chat-Eingabe (/preset) verwendet werden, nicht als serverseitiger Prompt: {{command}}',
    startupFailedTitle: 'Lygodactylus konnte nicht gestartet werden',
    startupFailedBody: '{{message}}\n\nWeitere Informationen finden Sie in den Protokollen.',
    configDefaultSetName: 'Standard',
    configFallbackSetName: 'Konfiguration {{index}}',
    errFetchTimeout: 'Zeitüberschreitung. Bitte Netzwerkverbindung prüfen und erneut versuchen.',
    errChromeNotReady: 'Chrome-Browser ist nicht bereit, Vorgang nicht möglich: {{detail}}',
    errNodeRuntimeUnavailable:
      'Die Node.js-Laufzeitumgebung ist noch nicht verfügbar. Die App lädt sie beim ersten MCP-Einsatz herunter.\n\nBitte mit dem Internet verbinden und das Öffnen der MCP-Server erneut versuchen.',
    hintMacosScreenRecording:
      '\n\nmacOS-Berechtigungshinweis:\n- Systemeinstellungen → Datenschutz & Sicherheit → Bildschirmaufnahme: Lygodactylus erlauben\n- App neu starten und erneut versuchen\n',
    hintMacosAccessibility:
      '\n\nmacOS-Berechtigungshinweis:\n- Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen: Lygodactylus erlauben\n- Bei Start aus dem Terminal: Terminal/iTerm erlauben\n- Nach der Freigabe Lygodactylus neu starten und erneut versuchen\n',
    hintMacosAccessibilityAutomation:
      '\n\nmacOS-Berechtigungshinweis:\n- Systemeinstellungen → Datenschutz & Sicherheit → Bedienungshilfen: Lygodactylus erlauben\n- Systemeinstellungen → Datenschutz & Sicherheit → Automatisierung: Lygodactylus die Steuerung von “System Events” erlauben\n',
    scheduleTitlePrefix: '[Geplante Aufgabe]',
    scheduleEmptyTitle: 'Unbenannte Aufgabe',
    traceRequestTimedOut: 'Zeitüberschreitung',
    atMentionNoWorkspace: 'Kein Arbeitsbereich verfügbar; @-Erwähnung konnte nicht aufgelöst werden.',
    atMentionPathEscapesWorkspace: 'Pfad liegt außerhalb des Arbeitsbereichs und wurde ignoriert: {{path}}',
    atMentionPathMissing: 'Datei oder Verzeichnis nicht gefunden: {{path}}',
    atMentionPathUnsupported: 'Nicht unterstützter Pfadtyp: {{path}}',
    atMentionDirectoryEmpty: 'Verzeichnis ist leer: {{path}}',
    atMentionDirectoryFailed: 'Verzeichnis {{path}} konnte nicht aufgelistet werden: {{error}}',
    atMentionFileTruncated: '[Gekürzt: erste {{limit}} Bytes von {{size}}]',
    atMentionFileFailed: 'Datei {{path}} konnte nicht gelesen werden: {{error}}',
    atMentionUrlFailed: 'URL {{url}} konnte nicht abgerufen werden: {{error}}',
    checkpointRestoreInvalidArgs: 'Ungültige Argumente für das Rückgängigmachen.',
    checkpointRestoreRunInProgress: 'In dieser Sitzung läuft noch ein Run; Rückgängigmachen nicht möglich.',
    checkpointRestoreNotFound: 'Kein Checkpoint für diesen Run gefunden.',
    checkpointRestoreFailed: 'Änderungen dieses Runs konnten nicht rückgängig gemacht werden.',
    errPiiScrubFailed: 'Maskierung personenbezogener Daten vor dem ausgehenden Aufruf fehlgeschlagen; Aufruf blockiert (fail-closed).',
  },
  it: {
    errModelTimeout:
      "Risposta del modello scaduta: nessuna risposta dal servizio upstream da un po'. Riprova più tardi o controlla il carico attuale del modello/gateway.",
    errRequestTimeout:
      '**Timeout della richiesta**: Nessuna risposta ricevuta da molto tempo. Operazione interrotta.',
    errSessionSetupTimeout:
      'Preparazione della sessione scaduta (oltre 3 minuti). Cause comuni: download iniziale dei runtime Node/Python, caricamento lento di plugin/skill o recupero memoria lento. Riprova tra poco; se persiste, disattiva temporaneamente la memoria o riduci i plugin attivi.',
    errEmptySuccess:
      'Il modello ha restituito un risultato vuoto pur con esito positivo. Il modello o il gateway attuale potrebbe avere un problema di compatibilità: riprova oppure cambia protocollo e riprova.',
    errContextOverflow:
      'Il contesto della conversazione è pieno. Avvia una nuova conversazione, accorcia i messaggi o riduci i token di output massimi nelle Impostazioni API. (Limite: {{limit}} token, usati: {{input}} input + {{output}} output)',
    errBadRequest:
      "La richiesta è stata rifiutata dall'upstream (400). La configurazione del modello/protocollo potrebbe essere incompatibile. Controlla il nome del modello, le impostazioni del protocollo e l'endpoint API.\nErrore originale: {{error}}",
    errAuthFailed:
      "Autenticazione non riuscita. Controlla se l'API Key è corretta, è scaduta o non ha accesso al modello attuale.\nErrore originale: {{error}}",
    errRateLimited:
      "La richiesta è stata sottoposta a limitazione della frequenza (429). Il modello o l'endpoint API attuale ha raggiunto il limite di frequenza delle chiamate. Riprova più tardi.\nErrore originale: {{error}}",
    errUpstreamError:
      "Il servizio upstream ha restituito un errore: il servizio del modello potrebbe essere sovraccarico o temporaneamente non disponibile. L'SDK riproverà automaticamente.\nErrore originale: {{error}}",
    errNetworkInterrupted:
      'La connessione di rete si è interrotta ({{error}}). Il proxy/gateway potrebbe essere instabile. L’SDK riproverà automaticamente.',
    errCheckConfigHint: '_Controlla la configurazione e riprova._',
    errRetryingHint: "_L'agente sta riprovando automaticamente, attendi..._",
    errContextCompactionHint:
      '_Contesto pieno. Compressione automatica in corso, oppure usa /compact per liberare spazio._',
    errConfigRequired:
      'Il set di configurazione attuale non ha credenziali utilizzabili. Completa prima la configurazione in Impostazioni API.',
    noticeCompactionStart: 'Compressione del contesto della conversazione in corso...',
    noticeCompactionFailed: 'Compressione del contesto non riuscita: {{error}}',
    noticeCompactionCompleted:
      'Compressione del contesto completata. Continuazione della richiesta.',
    noticeHandoffStart: 'Riassunto della conversazione per una nuova sessione in corso…',
    noticeHandoffFailed: 'Passaggio di sessione non riuscito: {{error}}',
    errUnknownSlashCommand: 'Comando slash sconosciuto: {{command}}',
    errPresetSlashClientOnly: 'I preset di prompt possono essere usati solo dall’input della chat (/preset), non come prompt lato server: {{command}}',
    startupFailedTitle: 'Avvio di Lygodactylus non riuscito',
    startupFailedBody: '{{message}}\n\nControlla i log per maggiori informazioni.',
    configDefaultSetName: 'Predefinito',
    configFallbackSetName: 'Configurazione {{index}}',
    errFetchTimeout: 'Timeout della richiesta. Controlla la connessione di rete e riprova.',
    errChromeNotReady: 'Il browser Chrome non è pronto, impossibile eseguire questa operazione: {{detail}}',
    errNodeRuntimeUnavailable:
      'Il runtime Node.js non è ancora disponibile. L’app lo scaricherà al primo utilizzo di MCP.\n\nConnettiti a Internet e riprova ad aprire i server MCP.',
    hintMacosScreenRecording:
      '\n\nSuggerimento autorizzazioni macOS:\n- Impostazioni di Sistema → Privacy e sicurezza → Registrazione schermo: consenti Lygodactylus\n- Riavvia l’app e riprova\n',
    hintMacosAccessibility:
      '\n\nSuggerimento autorizzazioni macOS:\n- Impostazioni di Sistema → Privacy e sicurezza → Accessibilità: consenti Lygodactylus\n- Se avviato da un terminale: consenti Terminal/iTerm\n- Dopo l’autorizzazione, riavvia Lygodactylus e riprova\n',
    hintMacosAccessibilityAutomation:
      '\n\nSuggerimento autorizzazioni macOS:\n- Impostazioni di Sistema → Privacy e sicurezza → Accessibilità: consenti Lygodactylus\n- Impostazioni di Sistema → Privacy e sicurezza → Automazione: consenti a Lygodactylus di controllare “System Events”\n',
    scheduleTitlePrefix: '[Scheduled Task]',
    scheduleEmptyTitle: 'Attività senza titolo',
    traceRequestTimedOut: 'Timeout della richiesta',
    atMentionNoWorkspace: 'Nessuna area di lavoro disponibile; impossibile risolvere la menzione @.',
    atMentionPathEscapesWorkspace: 'Percorso fuori dall’area di lavoro, ignorato: {{path}}',
    atMentionPathMissing: 'File o cartella non trovati: {{path}}',
    atMentionPathUnsupported: 'Tipo di percorso non supportato: {{path}}',
    atMentionDirectoryEmpty: 'Cartella vuota: {{path}}',
    atMentionDirectoryFailed: 'Impossibile elencare la cartella {{path}}: {{error}}',
    atMentionFileTruncated: '[Troncato: primi {{limit}} byte di {{size}}]',
    atMentionFileFailed: 'Impossibile leggere il file {{path}}: {{error}}',
    atMentionUrlFailed: 'Impossibile recuperare l’URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: "Argomenti di annullamento non validi.",
    checkpointRestoreRunInProgress:
      "È ancora in corso un'esecuzione su questa sessione; impossibile annullare.",
    checkpointRestoreNotFound: 'Nessun checkpoint trovato per questa esecuzione.',
    checkpointRestoreFailed: 'Impossibile annullare le modifiche di questa esecuzione.',
    errPiiScrubFailed: 'Mascheramento dei dati personali non riuscito prima della chiamata in uscita; chiamata bloccata (fail-closed).',
  },
  uk: {
    errModelTimeout:
      'Час очікування відповіді моделі вичерпано: вихідний сервіс деякий час не надсилав відповіді. Повторіть спробу пізніше або перевірте поточне навантаження на модель чи шлюз.',
    errRequestTimeout:
      '**Час очікування вичерпано**: довго не надходила відповідь, операцію перервано.',
    errSessionSetupTimeout:
      'Час підготовки сесії вичерпано (понад 3 хвилини). Типові причини: перше завантаження Node/Python runtime, повільне завантаження плагінів/навичок або повільний пошук у пам’яті. Спробуйте ще раз; якщо повторюється, тимчасово вимкніть пам’ять або зменште кількість плагінів.',
    errEmptySuccess:
      'Модель повернула порожній успішний результат. Можливо, поточна модель або шлюз має проблему сумісності — повторіть спробу або змініть протокол і спробуйте знову.',
    errContextOverflow:
      'Контекст розмови заповнено. Почніть нову розмову, скоротьте повідомлення або зменшіть максимальні вихідні токени в налаштуваннях API. (Ліміт: {{limit}} tokens, використано: {{input}} input + {{output}} output)',
    errBadRequest:
      'Запит відхилено на вихідному сервісі (400). Можливо, конфігурація моделі чи протоколу несумісна. Перевірте назву моделі, налаштування протоколу та точку доступу API.\nПервинна помилка: {{error}}',
    errAuthFailed:
      'Помилка автентифікації. Перевірте, чи правильний API Key, чи не сплив його строк дії та чи має він доступ до поточної моделі.\nПервинна помилка: {{error}}',
    errRateLimited:
      'Запит обмежено за частотою (429). Поточна модель або точка доступу API досягла ліміту частоти викликів. Повторіть спробу пізніше.\nПервинна помилка: {{error}}',
    errUpstreamError:
      'Вихідний сервіс повернув помилку — можливо, сервіс моделі перевантажений або тимчасово недоступний. SDK повторить спробу автоматично.\nПервинна помилка: {{error}}',
    errNetworkInterrupted:
      "Мережеве з'єднання було перервано ({{error}}). Можливо, проксі чи шлюз працює нестабільно. SDK повторить спробу автоматично.",
    errCheckConfigHint: '_Перевірте конфігурацію та повторіть спробу._',
    errRetryingHint: '_Агент повторює спробу автоматично, зачекайте..._',
    errContextCompactionHint:
      '_Контекст заповнений. Триває автоматичне стиснення або скористайтеся /compact._',
    errConfigRequired:
      'Поточний набір конфігурації не має придатних облікових даних. Спершу завершіть налаштування в розділі параметрів API.',
    noticeCompactionStart: 'Стискаємо контекст розмови, щоб звільнити місце...',
    noticeCompactionFailed: 'Не вдалося стиснути контекст: {{error}}',
    noticeCompactionCompleted: 'Стиснення контексту завершено. Продовжуємо запит.',
    noticeHandoffStart: 'Підсумовуємо цю розмову для нової сесії…',
    noticeHandoffFailed: 'Не вдалося передати сесію: {{error}}',
    errUnknownSlashCommand: 'Невідома slash-команда: {{command}}',
    errPresetSlashClientOnly: 'Пресети промптів можна використовувати лише з поля чату (/preset), а не як серверний промпт: {{command}}',
    startupFailedTitle: 'Не вдалося запустити Lygodactylus',
    startupFailedBody: '{{message}}\n\nПерегляньте журнали для отримання додаткової інформації.',
    configDefaultSetName: 'За замовчуванням',
    configFallbackSetName: 'Конфігурація {{index}}',
    errFetchTimeout: 'Час очікування вичерпано. Перевірте мережеве з’єднання та спробуйте знову.',
    errChromeNotReady: 'Браузер Chrome не готовий, неможливо виконати цю дію: {{detail}}',
    errNodeRuntimeUnavailable:
      'Середовище виконання Node.js ще недоступне. Програма завантажить його під час першого використання MCP.\n\nПідключіться до Інтернету та спробуйте знову відкрити сервери MCP.',
    hintMacosScreenRecording:
      '\n\nПідказка щодо дозволів macOS:\n- Системні параметри → Конфіденційність і безпека → Запис екрана: дозволити Lygodactylus\n- Перезапустіть програму та спробуйте знову\n',
    hintMacosAccessibility:
      '\n\nПідказка щодо дозволів macOS:\n- Системні параметри → Конфіденційність і безпека → Універсальний доступ: дозволити Lygodactylus\n- Якщо запущено з термінала: дозволити Terminal/iTerm\n- Після надання дозволу перезапустіть Lygodactylus і спробуйте знову\n',
    hintMacosAccessibilityAutomation:
      '\n\nПідказка щодо дозволів macOS:\n- Системні параметри → Конфіденційність і безпека → Універсальний доступ: дозволити Lygodactylus\n- Системні параметри → Конфіденційність і безпека → Автоматизація: дозволити Lygodactylus керувати “System Events”\n',
    scheduleTitlePrefix: '[Scheduled Task]',
    scheduleEmptyTitle: 'Завдання без назви',
    traceRequestTimedOut: 'Час очікування вичерпано',
    atMentionNoWorkspace: 'Немає доступної робочої області; згадку @ не вдалося розв’язати.',
    atMentionPathEscapesWorkspace: 'Шлях виходить за межі робочої області й проігноровано: {{path}}',
    atMentionPathMissing: 'Файл або каталог не знайдено: {{path}}',
    atMentionPathUnsupported: 'Непідтримуваний тип шляху: {{path}}',
    atMentionDirectoryEmpty: 'Каталог порожній: {{path}}',
    atMentionDirectoryFailed: 'Не вдалося отримати список каталогу {{path}}: {{error}}',
    atMentionFileTruncated: '[Обрізано: перші {{limit}} байтів із {{size}}]',
    atMentionFileFailed: 'Не вдалося прочитати файл {{path}}: {{error}}',
    atMentionUrlFailed: 'Не вдалося отримати URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Недійсні аргументи скасування.',
    checkpointRestoreRunInProgress: 'У цій сесії все ще виконується запуск; скасування неможливе.',
    checkpointRestoreNotFound: 'Контрольну точку для цього запуску не знайдено.',
    checkpointRestoreFailed: 'Не вдалося скасувати зміни цього запуску.',
    errPiiScrubFailed: 'Не вдалося замаскувати персональні дані перед вихідним викликом; виклик заблоковано (fail-closed).',
  },
  pl: {
    errModelTimeout:
      'Przekroczono limit czasu odpowiedzi modelu: usługa nadrzędna od pewnego czasu nie odpowiada. Spróbuj ponownie później lub sprawdź bieżące obciążenie modelu/bramy.',
    errRequestTimeout:
      '**Przekroczono limit czasu**: długo nie otrzymano odpowiedzi, operacja została przerwana.',
    errSessionSetupTimeout:
      'Przygotowanie sesji przekroczyło limit czasu (ponad 3 minuty). Typowe przyczyny: pierwsze pobieranie runtime Node/Python, wolne ładowanie pluginów/umiejętności lub wolne wyszukiwanie pamięci. Spróbuj ponownie; jeśli problem wraca, tymczasowo wyłącz pamięć lub ogranicz aktywne pluginy.',
    errEmptySuccess:
      'Model zwrócił pusty wynik mimo powodzenia. Bieżący model lub brama mogą mieć problem ze zgodnością — spróbuj ponownie albo zmień protokół i spróbuj jeszcze raz.',
    errContextOverflow:
      'Kontekst rozmowy jest pełny. Rozpocznij nową rozmowę, skróć wiadomości lub zmniejsz maksymalną liczbę tokenów wyjściowych w ustawieniach API. (Limit: {{limit}} tokenów, użyto: {{input}} input + {{output}} output)',
    errBadRequest:
      'Żądanie zostało odrzucone po stronie usługi nadrzędnej (400). Konfiguracja modelu/protokołu może być niezgodna. Sprawdź nazwę modelu, ustawienia protokołu oraz punkt końcowy API.\nBłąd źródłowy: {{error}}',
    errAuthFailed:
      'Uwierzytelnianie nie powiodło się. Sprawdź, czy API Key jest poprawny, nie wygasł oraz czy ma dostęp do bieżącego modelu.\nBłąd źródłowy: {{error}}',
    errRateLimited:
      'Żądanie zostało ograniczone przez limit szybkości (429). Bieżący model lub punkt końcowy API osiągnął limit liczby wywołań. Spróbuj ponownie później.\nBłąd źródłowy: {{error}}',
    errUpstreamError:
      'Usługa nadrzędna zwróciła błąd — usługa modelu może być przeciążona lub chwilowo niedostępna. SDK ponowi próbę automatycznie.\nBłąd źródłowy: {{error}}',
    errNetworkInterrupted:
      'Połączenie sieciowe zostało przerwane ({{error}}). Serwer proxy/brama mogą być niestabilne. SDK ponowi próbę automatycznie.',
    errCheckConfigHint: '_Sprawdź konfigurację i spróbuj ponownie._',
    errRetryingHint: '_Agent automatycznie ponawia próbę, proszę czekać..._',
    errContextCompactionHint:
      '_Kontekst jest pełny. Trwa automatyczna kompresja lub użyj /compact._',
    errConfigRequired:
      'Bieżący zestaw konfiguracji nie zawiera użytecznych poświadczeń. Najpierw dokończ konfigurację w ustawieniach API.',
    noticeCompactionStart: 'Kompresowanie kontekstu rozmowy w celu zwolnienia miejsca...',
    noticeCompactionFailed: 'Kompresja kontekstu nie powiodła się: {{error}}',
    noticeCompactionCompleted: 'Kompresja kontekstu zakończona. Kontynuowanie żądania.',
    noticeHandoffStart: 'Podsumowywanie rozmowy dla nowej sesji…',
    noticeHandoffFailed: 'Przekazanie sesji nie powiodło się: {{error}}',
    errUnknownSlashCommand: 'Nieznane polecenie slash: {{command}}',
    errPresetSlashClientOnly: 'Presety promptów można używać tylko z pola czatu (/preset), nie jako prompt po stronie serwera: {{command}}',
    startupFailedTitle: 'Nie udało się uruchomić Lygodactylus',
    startupFailedBody: '{{message}}\n\nSprawdź dzienniki, aby uzyskać więcej informacji.',
    configDefaultSetName: 'Domyślny',
    configFallbackSetName: 'Konfiguracja {{index}}',
    errFetchTimeout: 'Przekroczono limit czasu. Sprawdź połączenie sieciowe i spróbuj ponownie.',
    errChromeNotReady: 'Przeglądarka Chrome nie jest gotowa, nie można wykonać tej operacji: {{detail}}',
    errNodeRuntimeUnavailable:
      'Środowisko uruchomieniowe Node.js nie jest jeszcze dostępne. Aplikacja pobierze je przy pierwszym użyciu MCP.\n\nPołącz się z internetem i ponownie spróbuj otworzyć serwery MCP.',
    hintMacosScreenRecording:
      '\n\nWskazówka dotycząca uprawnień macOS:\n- Ustawienia systemowe → Prywatność i bezpieczeństwo → Nagrywanie ekranu: zezwól Lygodactylus\n- Uruchom ponownie aplikację i spróbuj jeszcze raz\n',
    hintMacosAccessibility:
      '\n\nWskazówka dotycząca uprawnień macOS:\n- Ustawienia systemowe → Prywatność i bezpieczeństwo → Dostępność: zezwól Lygodactylus\n- Jeśli uruchomiono z terminala: zezwól Terminal/iTerm\n- Po udzieleniu uprawnienia uruchom ponownie Lygodactylus i spróbuj jeszcze raz\n',
    hintMacosAccessibilityAutomation:
      '\n\nWskazówka dotycząca uprawnień macOS:\n- Ustawienia systemowe → Prywatność i bezpieczeństwo → Dostępność: zezwól Lygodactylus\n- Ustawienia systemowe → Prywatność i bezpieczeństwo → Automatyzacja: zezwól Lygodactylus na sterowanie “System Events”\n',
    scheduleTitlePrefix: '[Zadanie zaplanowane]',
    scheduleEmptyTitle: 'Zadanie bez nazwy',
    traceRequestTimedOut: 'Przekroczono limit czasu',
    atMentionNoWorkspace: 'Brak dostępnego obszaru roboczego; nie udało się rozwiązać wzmianki @.',
    atMentionPathEscapesWorkspace: 'Ścieżka poza obszarem roboczym — zignorowano: {{path}}',
    atMentionPathMissing: 'Nie znaleziono pliku ani katalogu: {{path}}',
    atMentionPathUnsupported: 'Nieobsługiwany typ ścieżki: {{path}}',
    atMentionDirectoryEmpty: 'Katalog jest pusty: {{path}}',
    atMentionDirectoryFailed: 'Nie udało się wyświetlić katalogu {{path}}: {{error}}',
    atMentionFileTruncated: '[Obcięto: pierwsze {{limit}} bajtów z {{size}}]',
    atMentionFileFailed: 'Nie udało się odczytać pliku {{path}}: {{error}}',
    atMentionUrlFailed: 'Nie udało się pobrać URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Nieprawidłowe argumenty cofania.',
    checkpointRestoreRunInProgress: 'W tej sesji nadal trwa uruchomienie; nie można cofnąć.',
    checkpointRestoreNotFound: 'Nie znaleziono punktu kontrolnego dla tego uruchomienia.',
    checkpointRestoreFailed: 'Nie udało się cofnąć zmian z tego uruchomienia.',
    errPiiScrubFailed: 'Maskowanie danych osobowych nie powiodło się przed wywołaniem wychodzącym; wywołanie zablokowano (fail-closed).',
  },
  sv: {
    errModelTimeout:
      'Modellsvaret tog för lång tid: inget svar från uppströmstjänsten på ett tag. Försök igen senare eller kontrollera den aktuella belastningen på modellen/gatewayen.',
    errRequestTimeout:
      '**Tidsgräns överskriden**: Inget svar mottogs på länge. Åtgärden avbröts.',
    errSessionSetupTimeout:
      'Sessionförberedelsen tog för lång tid (över 3 minuter). Vanliga orsaker: första nedladdningen av Node/Python-runtimes, långsam laddning av plugins/skills eller långsam minnesåterhämtning. Försök igen om en stund; om det kvarstår, inaktivera minnet tillfälligt eller minska aktiva plugins.',
    errEmptySuccess:
      'Modellen returnerade ett tomt lyckat resultat. Den aktuella modellen eller gatewayen kan ha ett kompatibilitetsproblem – försök igen eller byt protokoll och försök på nytt.',
    errContextOverflow:
      'Konversationskontexten är full. Starta en ny konversation, förkorta meddelanden eller sänk max antal utdatatokens i API-inställningarna. (Gräns: {{limit}} tokens, använt: {{input}} input + {{output}} output)',
    errBadRequest:
      'Begäran avvisades uppströms (400). Konfigurationen för modellen/protokollet kan vara inkompatibel. Kontrollera modellnamnet, protokollinställningarna och API-slutpunkten.\nUrsprungligt fel: {{error}}',
    errAuthFailed:
      'Autentiseringen misslyckades. Kontrollera om din API Key är korrekt, har upphört att gälla eller saknar åtkomst till den aktuella modellen.\nUrsprungligt fel: {{error}}',
    errRateLimited:
      'Begäran hastighetsbegränsades (429). Den aktuella modellen eller API-slutpunkten har nått sin gräns för anropsfrekvens. Försök igen senare.\nUrsprungligt fel: {{error}}',
    errUpstreamError:
      'Uppströmstjänsten returnerade ett fel – modelltjänsten kan vara överbelastad eller tillfälligt otillgänglig. SDK gör automatiskt ett nytt försök.\nUrsprungligt fel: {{error}}',
    errNetworkInterrupted:
      'Nätverksanslutningen avbröts ({{error}}). Proxyn/gatewayen kan vara instabil. SDK gör automatiskt ett nytt försök.',
    errCheckConfigHint: '_Kontrollera din konfiguration och försök igen._',
    errRetryingHint: '_Agenten försöker igen automatiskt, vänta..._',
    errContextCompactionHint:
      '_Kontexten är full. Komprimerar automatiskt, eller använd /compact för att frigöra utrymme._',
    errConfigRequired:
      'Den aktuella konfigurationsuppsättningen saknar användbara autentiseringsuppgifter. Slutför först konfigurationen i API-inställningarna.',
    noticeCompactionStart: 'Komprimerar konversationskontexten för att frigöra utrymme...',
    noticeCompactionFailed: 'Kontextkomprimering misslyckades: {{error}}',
    noticeCompactionCompleted: 'Kontextkomprimering slutförd. Fortsätter begäran.',
    noticeHandoffStart: 'Sammanfattar den här konversationen för en ny session…',
    noticeHandoffFailed: 'Sessionsöverlämning misslyckades: {{error}}',
    errUnknownSlashCommand: 'Okänt snedstreckskommando: {{command}}',
    errPresetSlashClientOnly: 'Promptförinställningar kan bara användas från chatinmatningen (/preset), inte som serverprompt: {{command}}',
    startupFailedTitle: 'Lygodactylus kunde inte starta',
    startupFailedBody: '{{message}}\n\nKontrollera loggarna för mer information.',
    configDefaultSetName: 'Standard',
    configFallbackSetName: 'Konfiguration {{index}}',
    errFetchTimeout: 'Tidsgränsen överskreds. Kontrollera nätverksanslutningen och försök igen.',
    errChromeNotReady: 'Chrome-webbläsaren är inte redo, åtgärden kan inte utföras: {{detail}}',
    errNodeRuntimeUnavailable:
      'Node.js-körningsmiljön är ännu inte tillgänglig. Appen laddar ner den vid första MCP-användningen.\n\nAnslut till internet och försök öppna MCP-servrarna igen.',
    hintMacosScreenRecording:
      '\n\nTips om macOS-behörigheter:\n- Systeminställningar → Integritet och säkerhet → Skärminspelning: tillåt Lygodactylus\n- Starta om appen och försök igen\n',
    hintMacosAccessibility:
      '\n\nTips om macOS-behörigheter:\n- Systeminställningar → Integritet och säkerhet → Hjälpmedel: tillåt Lygodactylus\n- Om den startas från en terminal: tillåt Terminal/iTerm\n- Efter att behörighet getts, starta om Lygodactylus och försök igen\n',
    hintMacosAccessibilityAutomation:
      '\n\nTips om macOS-behörigheter:\n- Systeminställningar → Integritet och säkerhet → Hjälpmedel: tillåt Lygodactylus\n- Systeminställningar → Integritet och säkerhet → Automatisering: tillåt Lygodactylus att styra “System Events”\n',
    scheduleTitlePrefix: '[Schemalagd uppgift]',
    scheduleEmptyTitle: 'Namnlös uppgift',
    traceRequestTimedOut: 'Tidsgräns överskriden',
    atMentionNoWorkspace: 'Ingen arbetsyta tillgänglig; @-omnämnandet kunde inte lösas.',
    atMentionPathEscapesWorkspace: 'Sökvägen ligger utanför arbetsytan och ignorerades: {{path}}',
    atMentionPathMissing: 'Fil eller katalog hittades inte: {{path}}',
    atMentionPathUnsupported: 'Sökvägstyp stöds inte: {{path}}',
    atMentionDirectoryEmpty: 'Katalogen är tom: {{path}}',
    atMentionDirectoryFailed: 'Kunde inte lista katalogen {{path}}: {{error}}',
    atMentionFileTruncated: '[Avkortad: första {{limit}} byten av {{size}}]',
    atMentionFileFailed: 'Kunde inte läsa filen {{path}}: {{error}}',
    atMentionUrlFailed: 'Kunde inte hämta URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Ogiltiga argument för ångra.',
    checkpointRestoreRunInProgress: 'En körning pågår fortfarande i den här sessionen; kan inte ångra.',
    checkpointRestoreNotFound: 'Ingen kontrollpunkt hittades för den här körningen.',
    checkpointRestoreFailed: 'Det gick inte att ångra ändringarna från den här körningen.',
    errPiiScrubFailed: 'Maskering av personuppgifter misslyckades före det utgående anropet; anropet blockerades (fail-closed).',
  },
  no: {
    errModelTimeout:
      'Tidsavbrudd for modellsvaret: ingen respons fra den underliggende tjenesten på en stund. Prøv igjen senere, eller sjekk gjeldende belastning på modellen/gatewayen.',
    errRequestTimeout:
      '**Tidsavbrudd**: Ingen respons mottatt på lenge. Operasjonen ble avbrutt.',
    errSessionSetupTimeout:
      'Klargjøring av økten tok for lang tid (over 3 minutter). Vanlige årsaker: første nedlasting av Node/Python-runtimes, treg lasting av plugins/skills eller treg minnehenting. Prøv igjen om litt; hvis det vedvarer, deaktiver minnet midlertidig eller reduser aktive plugins.',
    errEmptySuccess:
      'Modellen returnerte et tomt, vellykket resultat. Gjeldende modell eller gateway kan ha et kompatibilitetsproblem – prøv igjen, eller bytt protokoll og prøv på nytt.',
    errContextOverflow:
      'Samtalekonteksten er full. Start en ny samtale, forkort meldingene eller senk maks antall utdatatokens i API-innstillingene. (Grense: {{limit}} tokens, brukt: {{input}} input + {{output}} output)',
    errBadRequest:
      'Forespørselen ble avvist av den underliggende tjenesten (400). Modell-/protokollkonfigurasjonen kan være inkompatibel. Sjekk modellnavnet, protokollinnstillingene og API-endepunktet.\nOpprinnelig feil: {{error}}',
    errAuthFailed:
      'Autentiseringen mislyktes. Sjekk om API Key er riktig, har utløpt, eller mangler tilgang til gjeldende modell.\nOpprinnelig feil: {{error}}',
    errRateLimited:
      'Forespørselen ble begrenset på grunn av for høy frekvens (429). Gjeldende modell eller API-endepunkt har nådd grensen for antall kall. Prøv igjen senere.\nOpprinnelig feil: {{error}}',
    errUpstreamError:
      'Den underliggende tjenesten returnerte en feil – modelltjenesten kan være overbelastet eller midlertidig utilgjengelig. SDK prøver automatisk på nytt.\nOpprinnelig feil: {{error}}',
    errNetworkInterrupted:
      'Nettverkstilkoblingen ble avbrutt ({{error}}). Proxyen/gatewayen kan være ustabil. SDK prøver automatisk på nytt.',
    errCheckConfigHint: '_Sjekk konfigurasjonen og prøv igjen._',
    errRetryingHint: '_Agenten prøver automatisk på nytt, vent litt …_',
    errContextCompactionHint:
      '_Konteksten er full. Komprimerer automatisk, eller bruk /compact for å frigjøre plass._',
    errConfigRequired:
      'Gjeldende konfigurasjonssett har ingen brukbare legitimasjoner. Fullfør oppsettet i API-innstillinger først.',
    noticeCompactionStart: 'Komprimerer samtalekonteksten for å frigjøre plass...',
    noticeCompactionFailed: 'Kontekstkomprimering mislyktes: {{error}}',
    noticeCompactionCompleted: 'Kontekstkomprimering fullført. Fortsetter forespørselen.',
    noticeHandoffStart: 'Oppsummerer denne samtalen for en ny økt…',
    noticeHandoffFailed: 'Øktoverlevering mislyktes: {{error}}',
    errUnknownSlashCommand: 'Ukjent skråstrek-kommando: {{command}}',
    errPresetSlashClientOnly: 'Prompt-forhåndsinnstillinger kan bare brukes fra chat-inndata (/preset), ikke som server-prompt: {{command}}',
    startupFailedTitle: 'Lygodactylus kunne ikke starte',
    startupFailedBody: '{{message}}\n\nSjekk loggene for mer informasjon.',
    configDefaultSetName: 'Standard',
    configFallbackSetName: 'Konfigurasjon {{index}}',
    errFetchTimeout: 'Forespørselen tidsavbrutt. Sjekk nettverkstilkoblingen og prøv igjen.',
    errChromeNotReady: 'Chrome-nettleseren er ikke klar, kan ikke utføre denne handlingen: {{detail}}',
    errNodeRuntimeUnavailable:
      'Node.js-kjøretiden er ikke tilgjengelig ennå. Appen laster den ned ved første MCP-bruk.\n\nKoble til internett og prøv å åpne MCP-serverne på nytt.',
    hintMacosScreenRecording:
      '\n\nTips om macOS-tillatelser:\n- Systeminnstillinger → Personvern og sikkerhet → Skjermopptak: tillat Lygodactylus\n- Start appen på nytt og prøv igjen\n',
    hintMacosAccessibility:
      '\n\nTips om macOS-tillatelser:\n- Systeminnstillinger → Personvern og sikkerhet → Tilgjengelighet: tillat Lygodactylus\n- Hvis startet fra en terminal: tillat Terminal/iTerm\n- Etter at tillatelsen er gitt, start Lygodactylus på nytt og prøv igjen\n',
    hintMacosAccessibilityAutomation:
      '\n\nTips om macOS-tillatelser:\n- Systeminnstillinger → Personvern og sikkerhet → Tilgjengelighet: tillat Lygodactylus\n- Systeminnstillinger → Personvern og sikkerhet → Automatisering: tillat Lygodactylus å styre “System Events”\n',
    scheduleTitlePrefix: '[Planlagt oppgave]',
    scheduleEmptyTitle: 'Oppgave uten navn',
    traceRequestTimedOut: 'Forespørsel tidsavbrutt',
    atMentionNoWorkspace: 'Ingen arbeidsmappe tilgjengelig; @-omtalen kunne ikke løses.',
    atMentionPathEscapesWorkspace: 'Stien er utenfor arbeidsmappen og ble ignorert: {{path}}',
    atMentionPathMissing: 'Fil eller mappe ble ikke funnet: {{path}}',
    atMentionPathUnsupported: 'Stitype støttes ikke: {{path}}',
    atMentionDirectoryEmpty: 'Mappen er tom: {{path}}',
    atMentionDirectoryFailed: 'Kunne ikke liste mappen {{path}}: {{error}}',
    atMentionFileTruncated: '[Avkortet: første {{limit}} byte av {{size}}]',
    atMentionFileFailed: 'Kunne ikke lese filen {{path}}: {{error}}',
    atMentionUrlFailed: 'Kunne ikke hente URL {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Ugyldige argumenter for angre.',
    checkpointRestoreRunInProgress: 'En kjøring pågår fortsatt i denne økten; kan ikke angre.',
    checkpointRestoreNotFound: 'Ingen sjekkpunkt funnet for denne kjøringen.',
    checkpointRestoreFailed: 'Kunne ikke angre endringene fra denne kjøringen.',
    errPiiScrubFailed: 'Maskering av personopplysninger mislyktes før det utgående kallet; kallet ble blokkert (fail-closed).',
  },
  nl: {
    errModelTimeout:
      'Time-out bij modelantwoord: het upstream-service reageerde een tijd lang niet. Probeer het later opnieuw of controleer de huidige belasting van het model/de gateway.',
    errRequestTimeout:
      '**Time-out**: Lange tijd geen reactie ontvangen. De bewerking is afgebroken.',
    errSessionSetupTimeout:
      'Het voorbereiden van de sessie is verlopen (meer dan 3 minuten). Veelvoorkomende oorzaken: eerste download van Node/Python-runtimes, traag laden van plugins/skills of trage geheugenopvraging. Probeer het zo opnieuw; blijft het probleem, schakel geheugen tijdelijk uit of verminder actieve plugins.',
    errEmptySuccess:
      'Het model gaf een leeg succesvol resultaat terug. Mogelijk is er een compatibiliteitsprobleem met het huidige model of de gateway — probeer het opnieuw of schakel over op een ander protocol en probeer het nogmaals.',
    errContextOverflow:
      'De gesprekscontext is vol. Start een nieuw gesprek, verkort berichten of verlaag het maximum aantal outputtokens in de API-instellingen. (Limiet: {{limit}} tokens, gebruikt: {{input}} input + {{output}} output)',
    errBadRequest:
      'De aanvraag werd upstream geweigerd (400). Mogelijk is de model-/protocolconfiguratie niet compatibel. Controleer de modelnaam, de protocolinstellingen en het API-eindpunt.\nOorspronkelijke fout: {{error}}',
    errAuthFailed:
      'Verificatie mislukt. Controleer of de API Key juist is, niet verlopen is en toegang heeft tot het huidige model.\nOorspronkelijke fout: {{error}}',
    errRateLimited:
      'De aanvraag is gelimiteerd (429). Het huidige model of API-eindpunt heeft zijn limiet voor het aantal aanroepen bereikt. Probeer het later opnieuw.\nOorspronkelijke fout: {{error}}',
    errUpstreamError:
      'Het upstream-service gaf een fout terug — de modelservice is mogelijk overbelast of tijdelijk niet beschikbaar. De SDK probeert het automatisch opnieuw.\nOorspronkelijke fout: {{error}}',
    errNetworkInterrupted:
      'De netwerkverbinding werd onderbroken ({{error}}). De proxy/gateway is mogelijk instabiel. De SDK probeert het automatisch opnieuw.',
    errCheckConfigHint: '_Controleer je configuratie en probeer het opnieuw._',
    errRetryingHint: '_De agent probeert het automatisch opnieuw, even geduld..._',
    errContextCompactionHint:
      '_Context is vol. Automatisch comprimeren, of gebruik /compact om ruimte vrij te maken._',
    errConfigRequired:
      'De huidige configuratieset bevat geen bruikbare inloggegevens. Voltooi eerst de installatie in de API-instellingen.',
    noticeCompactionStart: 'Gesprekscontext wordt gecomprimeerd om ruimte vrij te maken...',
    noticeCompactionFailed: 'Contextcompressie mislukt: {{error}}',
    noticeCompactionCompleted: 'Contextcompressie voltooid. Verzoek wordt voortgezet.',
    noticeHandoffStart: 'Dit gesprek wordt samengevat voor een nieuwe sessie…',
    noticeHandoffFailed: 'Sessieoverdracht mislukt: {{error}}',
    errUnknownSlashCommand: 'Onbekend slash-commando: {{command}}',
    errPresetSlashClientOnly: 'Prompt-presets kunnen alleen vanuit de chatinvoer (/preset) worden gebruikt, niet als serverprompt: {{command}}',
    startupFailedTitle: 'Lygodactylus kon niet worden gestart',
    startupFailedBody: '{{message}}\n\nRaadpleeg de logbestanden voor meer informatie.',
    configDefaultSetName: 'Standaard',
    configFallbackSetName: 'Configuratie {{index}}',
    errFetchTimeout: 'Time-out van het verzoek. Controleer je netwerkverbinding en probeer het opnieuw.',
    errChromeNotReady: 'Chrome-browser is niet gereed, deze actie kan niet worden uitgevoerd: {{detail}}',
    errNodeRuntimeUnavailable:
      'De Node.js-runtime is nog niet beschikbaar. De app downloadt deze bij het eerste MCP-gebruik.\n\nMaak verbinding met internet en probeer de MCP-servers opnieuw te openen.',
    hintMacosScreenRecording:
      '\n\nHint voor macOS-machtigingen:\n- Systeeminstellingen → Privacy en beveiliging → Schermopname: Lygodactylus toestaan\n- Herstart de app en probeer het opnieuw\n',
    hintMacosAccessibility:
      '\n\nHint voor macOS-machtigingen:\n- Systeeminstellingen → Privacy en beveiliging → Toegankelijkheid: Lygodactylus toestaan\n- Indien gestart vanuit een terminal: Terminal/iTerm toestaan\n- Na het verlenen van toestemming Lygodactylus herstarten en opnieuw proberen\n',
    hintMacosAccessibilityAutomation:
      '\n\nHint voor macOS-machtigingen:\n- Systeeminstellingen → Privacy en beveiliging → Toegankelijkheid: Lygodactylus toestaan\n- Systeeminstellingen → Privacy en beveiliging → Automatisering: Lygodactylus toestaan “System Events” te bedienen\n',
    scheduleTitlePrefix: '[Scheduled Task]',
    scheduleEmptyTitle: 'Naamloze taak',
    traceRequestTimedOut: 'Verzoek time-out',
    atMentionNoWorkspace: 'Geen werkruimte beschikbaar; @-vermelding kon niet worden opgelost.',
    atMentionPathEscapesWorkspace: 'Pad ligt buiten de werkruimte en is genegeerd: {{path}}',
    atMentionPathMissing: 'Bestand of map niet gevonden: {{path}}',
    atMentionPathUnsupported: 'Niet-ondersteund padtype: {{path}}',
    atMentionDirectoryEmpty: 'Map is leeg: {{path}}',
    atMentionDirectoryFailed: 'Kon map {{path}} niet weergeven: {{error}}',
    atMentionFileTruncated: '[Afgekapt: eerste {{limit}} bytes van {{size}}]',
    atMentionFileFailed: 'Kon bestand {{path}} niet lezen: {{error}}',
    atMentionUrlFailed: 'Kon URL {{url}} niet ophalen: {{error}}',
    checkpointRestoreInvalidArgs: 'Ongeldige argumenten voor ongedaan maken.',
    checkpointRestoreRunInProgress: 'Er loopt nog een uitvoering in deze sessie; ongedaan maken is niet mogelijk.',
    checkpointRestoreNotFound: 'Geen checkpoint gevonden voor deze uitvoering.',
    checkpointRestoreFailed: 'Wijzigingen van deze uitvoering ongedaan maken is mislukt.',
    errPiiScrubFailed: 'Maskeren van persoonsgegevens mislukt vóór de uitgaande aanroep; aanroep geblokkeerd (fail-closed).',
  },
  ro: {
    errModelTimeout:
      'Răspunsul modelului a expirat: niciun răspuns de la serviciul din amonte pentru o vreme. Reîncearcă mai târziu sau verifică gradul de încărcare al modelului/gateway-ului.',
    errRequestTimeout:
      '**Timp de așteptare depășit**: Nu s-a primit răspuns de mult timp. Operațiunea a fost întreruptă.',
    errSessionSetupTimeout:
      'Pregătirea sesiunii a expirat (peste 3 minute). Cauze frecvente: descărcarea inițială a runtime-urilor Node/Python, încărcarea lentă a plugin-urilor/skill-urilor sau recuperarea lentă a memoriei. Reîncearcă în curând; dacă persistă, dezactivează temporar memoria sau reduce plugin-urile active.',
    errEmptySuccess:
      'Modelul a returnat un rezultat reușit, dar gol. Este posibil ca modelul sau gateway-ul curent să aibă o problemă de compatibilitate — reîncearcă sau schimbă protocolul și încearcă din nou.',
    errContextOverflow:
      'Contextul conversației este plin. Începe o conversație nouă, scurtează mesajele sau reduce tokenii maximi de ieșire din Setări API. (Limită: {{limit}} tokeni, folosit: {{input}} input + {{output}} output)',
    errBadRequest:
      'Cererea a fost respinsă în amonte (400). Configurația modelului/protocolului poate fi incompatibilă. Verifică numele modelului, setările de protocol și punctul de acces API.\nEroare originală: {{error}}',
    errAuthFailed:
      'Autentificarea a eșuat. Verifică dacă API Key este corectă, a expirat sau nu are acces la modelul curent.\nEroare originală: {{error}}',
    errRateLimited:
      'Cererea a fost limitată ca rată (429). Modelul sau punctul de acces API curent a atins limita de rată a apelurilor. Reîncearcă mai târziu.\nEroare originală: {{error}}',
    errUpstreamError:
      'Serviciul din amonte a returnat o eroare — este posibil ca serviciul modelului să fie suprasolicitat sau temporar indisponibil. SDK va reîncerca automat.\nEroare originală: {{error}}',
    errNetworkInterrupted:
      'Conexiunea la rețea a fost întreruptă ({{error}}). Este posibil ca proxy-ul/gateway-ul să fie instabil. SDK va reîncerca automat.',
    errCheckConfigHint: '_Verifică configurația și reîncearcă._',
    errRetryingHint: '_Agentul reîncearcă automat, te rugăm să aștepți..._',
    errContextCompactionHint:
      '_Contextul este plin. Se compactează automat, sau folosește /compact pentru a elibera spațiu._',
    errConfigRequired:
      'Setul de configurație curent nu are credențiale utilizabile. Finalizează mai întâi configurarea în Setări API.',
    noticeCompactionStart: 'Se compactează contextul conversației pentru a elibera spațiu...',
    noticeCompactionFailed: 'Compactarea contextului a eșuat: {{error}}',
    noticeCompactionCompleted: 'Compactarea contextului s-a încheiat. Se continuă cererea.',
    noticeHandoffStart: 'Se rezumă această conversație pentru o sesiune nouă…',
    noticeHandoffFailed: 'Transferul sesiunii a eșuat: {{error}}',
    errUnknownSlashCommand: 'Comandă slash necunoscută: {{command}}',
    errPresetSlashClientOnly: 'Presetările de prompt pot fi folosite doar din câmpul de chat (/preset), nu ca prompt pe server: {{command}}',
    startupFailedTitle: 'Lygodactylus nu a putut porni',
    startupFailedBody: '{{message}}\n\nVerifică jurnalele pentru mai multe informații.',
    configDefaultSetName: 'Implicit',
    configFallbackSetName: 'Configurația {{index}}',
    errFetchTimeout: 'Cererea a expirat. Verifică conexiunea la rețea și încearcă din nou.',
    errChromeNotReady: 'Browserul Chrome nu este gata, această acțiune nu poate fi efectuată: {{detail}}',
    errNodeRuntimeUnavailable:
      'Runtime-ul Node.js nu este încă disponibil. Aplicația îl va descărca la prima utilizare MCP.\n\nConectează-te la internet și încearcă din nou să deschizi serverele MCP.',
    hintMacosScreenRecording:
      '\n\nSugestie pentru permisiunile macOS:\n- Setări sistem → Confidențialitate și securitate → Înregistrare ecran: permite Lygodactylus\n- Repornește aplicația și încearcă din nou\n',
    hintMacosAccessibility:
      '\n\nSugestie pentru permisiunile macOS:\n- Setări sistem → Confidențialitate și securitate → Accesibilitate: permite Lygodactylus\n- Dacă este lansat dintr-un terminal: permite Terminal/iTerm\n- După acordarea permisiunii, repornește Lygodactylus și încearcă din nou\n',
    hintMacosAccessibilityAutomation:
      '\n\nSugestie pentru permisiunile macOS:\n- Setări sistem → Confidențialitate și securitate → Accesibilitate: permite Lygodactylus\n- Setări sistem → Confidențialitate și securitate → Automatizare: permite Lygodactylus să controleze “System Events”\n',
    scheduleTitlePrefix: '[Scheduled Task]',
    scheduleEmptyTitle: 'Sarcină fără nume',
    traceRequestTimedOut: 'Cererea a expirat',
    atMentionNoWorkspace: 'Niciun spațiu de lucru disponibil; mențiunea @ nu a putut fi rezolvată.',
    atMentionPathEscapesWorkspace: 'Calea iese din spațiul de lucru și a fost ignorată: {{path}}',
    atMentionPathMissing: 'Fișier sau director negăsit: {{path}}',
    atMentionPathUnsupported: 'Tip de cale neacceptat: {{path}}',
    atMentionDirectoryEmpty: 'Directorul este gol: {{path}}',
    atMentionDirectoryFailed: 'Nu s-a putut lista directorul {{path}}: {{error}}',
    atMentionFileTruncated: '[Trunchiat: primii {{limit}} octeți din {{size}}]',
    atMentionFileFailed: 'Nu s-a putut citi fișierul {{path}}: {{error}}',
    atMentionUrlFailed: 'Nu s-a putut prelua URL-ul {{url}}: {{error}}',
    checkpointRestoreInvalidArgs: 'Argumente invalide pentru anulare.',
    checkpointRestoreRunInProgress: 'O execuție este încă în curs pe această sesiune; nu se poate anula.',
    checkpointRestoreNotFound: 'Nu a fost găsit niciun punct de control pentru această execuție.',
    checkpointRestoreFailed: 'Nu s-au putut anula modificările acestei execuții.',
    errPiiScrubFailed: 'Mascarea datelor personale a eșuat înainte de apelul de ieșire; apelul a fost blocat (fail-closed).',
  },
};
