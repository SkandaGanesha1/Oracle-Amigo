using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

const string AUMID = "OracleAmigo.NotificationBridge";
const string DISPLAY_NAME = "Oracle Amigo Agent";
const string ICON_PATH = ""; // could be set to an .ico file path

// Log path resolution: explicit env override wins; otherwise fall back to
// %LOCALAPPDATA%\OracleAmigo\logs\notification-bridge.log (created on demand).
// The previous version hardcoded a path under the developer's personal temp
// directory, which broke for any other user.
string ResolveLogPath()
{
    var explicitPath = Environment.GetEnvironmentVariable("ORACLE_AMIGO_NOTIFICATION_LOG_PATH");
    if (!string.IsNullOrWhiteSpace(explicitPath)) return explicitPath;
    var localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
    var baseDir = string.IsNullOrEmpty(localAppData)
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "OracleAmigo", "logs")
        : Path.Combine(localAppData, "OracleAmigo", "logs");
    Directory.CreateDirectory(baseDir);
    return Path.Combine(baseDir, "notification-bridge.log");
}

void Log(string msg)
{
    var line = $"[bridge] {msg}";
    Console.Error.WriteLine(line);
    try { System.IO.File.AppendAllText(ResolveLogPath(), $"{DateTime.Now:HH:mm:ss.fff} {line}\n"); } catch { }
}

// Idempotency: the same approval can be invoked more than once if the user
// taps a toast after we've already processed it (Windows keeps the toast in
// the Action Center). Track processed approval IDs in memory and short-circuit
// duplicate callbacks so the local agent never sees the same approval twice.
var processedApprovals = new ConcurrentDictionary<string, byte>();

Log("=== Bridge starting ===");
Log($"Process ID: {Environment.ProcessId}");
Log($"AUMID: {AUMID}");

var port = Environment.GetEnvironmentVariable("NOTIFICATION_BRIDGE_PORT") ?? "3400";
Log($"Step 1: Starting HttpListener on port {port}");
var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
bool isListenerStarted = false;
try
{
    listener.Start();
    Log("HttpListener started");
    isListenerStarted = true;
}
catch (Exception ex)
{
    Log($"HttpListener.Start FAILED (port already in use?): {ex.Message}. Running in toast-activation only mode.");
}

AppNotificationManager? notificationManager = null;
try
{
    notificationManager = AppNotificationManager.Default;
    notificationManager.NotificationInvoked += (_, args) =>
    {
        Log($"[toast] NotificationInvoked: raw='{args.Argument}'");
        var argsDict = ParseArguments(args.Argument);
        var action = argsDict.GetValueOrDefault("action", "");
        var kind = argsDict.GetValueOrDefault("kind", "");
        var approvalId = argsDict.GetValueOrDefault("approval_id", "");
        var taskId = argsDict.GetValueOrDefault("task_id", "");
        var candidateId = argsDict.GetValueOrDefault("candidate_id", "");
        var nonce = argsDict.GetValueOrDefault("nonce", "");
        var signature = argsDict.GetValueOrDefault("signature", "");
        var feedback = "";
        if (args.UserInput != null && args.UserInput.TryGetValue("feedback", out var f))
        {
            feedback = f;
        }

        if (kind == "chat_message" || kind == "system" || string.IsNullOrEmpty(approvalId))
        {
            Log($"[toast] Non-approval activation: kind='{kind}', conversation='{argsDict.GetValueOrDefault("conversation_id", "")}', message='{argsDict.GetValueOrDefault("message_id", "")}'");
            return;
        }

        // Idempotency guard: skip duplicate invokes for the same approval.
        // The key is "approval|action" so a user can still re-reject an
        // already-approved approval if the UI allows it.
        var dedupKey = $"{approvalId}|{action}";
        if (!string.IsNullOrEmpty(approvalId) && !processedApprovals.TryAdd(dedupKey, 0))
        {
            Log($"[toast] Skipping duplicate invoke for {dedupKey}");
            return;
        }

        var localPort = argsDict.GetValueOrDefault("local_port", Environment.GetEnvironmentVariable("LOCAL_AGENT_PORT") ?? "3399");
        var callbackPayload = new Dictionary<string, object?>
        {
            ["approvalId"] = approvalId,
            ["taskId"] = taskId,
            ["action"] = action,
            ["feedback"] = feedback,
            ["candidateId"] = candidateId,
            ["nonce"] = nonce,
            ["signature"] = signature,
        };

        try
        {
            using var client = new HttpClient();
            var content = new StringContent(
                JsonSerializer.Serialize(callbackPayload),
                Encoding.UTF8,
                "application/json"
            );
            var response = client.PostAsync($"http://127.0.0.1:{localPort}/approvals/notification-callback", content)
                .GetAwaiter().GetResult();
            Log($"[toast] Callback response: {(int)response.StatusCode}");
            
            // Clear dedup record on failure so the user can retry.
            if (!response.IsSuccessStatusCode)
            {
                processedApprovals.TryRemove(dedupKey, out var discard);
                Log($"[toast] Local agent reported failure ({response.StatusCode}); cleared dedup record for {dedupKey}");
            }
        }
        catch (Exception ex)
        {
            Log($"[toast] Callback FAILED: {ex.Message}");
            // Network blip — release the dedup record so the next attempt can try again.
            if (!string.IsNullOrEmpty(approvalId)) processedApprovals.TryRemove(dedupKey, out var discard);
        }
    };

    // Parameterless Register() auto-registers the exe as COM server,
    // derives DisplayName from the exe name, and uses the exe's embedded icon
    // via the shell. This is the supported path for unpackaged apps.
    notificationManager.Register();
    Log($"AppNotificationManager registered (parameterless - auto AUMID for unpackaged)");
}
catch (Exception ex)
{
    Log($"AppNotificationManager setup FAILED: {ex.Message}");
    Log(ex.StackTrace ?? "");
}

Log($"Notification bridge listening on http://127.0.0.1:{port}");

while (true)
{
    if (!isListenerStarted)
    {
        // If we are a secondary instance (e.g. launched by COM to handle toast activation),
        // we wait for a reasonable time to let the NotificationInvoked handler run, and then exit.
        Log("No listener active. Waiting 10 seconds for toast activation handler, then exiting.");
        await Task.Delay(10000);
        Log("Exit: Toast activation handler window closed.");
        break;
    }

    HttpListenerContext context;
    try
    {
        context = await listener.GetContextAsync();
    }
    catch (Exception ex)
    {
        Log($"GetContextAsync FAILED: {ex.Message}");
        break;
    }
    Log($"Request: {context.Request.HttpMethod} {context.Request.Url?.AbsolutePath}");
    var request = context.Request;
    var response = context.Response;

    if (request.HttpMethod == "GET" && request.Url?.AbsolutePath == "/health")
    {
        var supported = OperatingSystem.IsWindows() && OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041);
        var body = JsonSerializer.Serialize(new
        {
            status = "ok",
            supported,
            aumid = AUMID,
            notificationManagerReady = notificationManager != null
        });
        await WriteResponse(response, body);
        continue;
    }

    if (request.HttpMethod == "POST" && request.Url?.AbsolutePath == "/notify")
    {
        using var reader = new StreamReader(request.InputStream);
        var bodyStr = await reader.ReadToEndAsync();
        NotifyParams? notifyParams;
        try { notifyParams = JsonSerializer.Deserialize<NotifyParams>(bodyStr, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }); }
        catch (Exception ex) { notifyParams = null; Log($"[notify] JSON parse FAILED: {ex.Message}"); }

        if (notifyParams == null)
        {
            var errBody = JsonSerializer.Serialize(new { supported = false, error = "Invalid JSON" });
            response.StatusCode = 400;
            await WriteResponse(response, errBody);
            continue;
        }

        try
        {
            var builder = BuildNotification(notifyParams);

            var toast = builder.BuildNotification();
            toast.Tag = notifyParams.NotificationId ?? notifyParams.ApprovalId ?? notifyParams.MessageId ?? "default";
            toast.Group = notifyParams.Kind == "chat_message" ? "messages" : notifyParams.Kind == "system" ? "system" : "approvals";

            notificationManager ??= AppNotificationManager.Default;
            notificationManager.Show(toast);
            Log($"[notify] Toast SHOWN kind={notifyParams.Kind ?? "approval"} notification={notifyParams.NotificationId ?? notifyParams.ApprovalId ?? notifyParams.MessageId}");

            var okBody = JsonSerializer.Serialize(new
            {
                supported = true,
                aumid = AUMID,
                notificationId = notifyParams.NotificationId,
                approvalId = notifyParams.ApprovalId,
                messageId = notifyParams.MessageId
            });
            await WriteResponse(response, okBody);
        }
        catch (Exception ex)
        {
            Log($"[notify] Show FAILED: {ex.GetType().Name}: {ex.Message}");
            var errBody = JsonSerializer.Serialize(new
            {
                supported = false,
                error = ex.Message,
                aumid = AUMID
            });
            response.StatusCode = 500;
            await WriteResponse(response, errBody);
        }
        continue;
    }

    response.StatusCode = 404;
    await WriteResponse(response, JsonSerializer.Serialize(new { error = "Not found" }));
}

void RegisterAumid() { /* AUMID is registered automatically by AppNotificationManager.Register(displayName, iconUri) */ }
void EnsureStartMenuShortcut() { /* Start Menu shortcut is created automatically by AppNotificationManager.Register(displayName, iconUri) */ }

static Dictionary<string, string> ParseArguments(string argument)
{
    var dict = new Dictionary<string, string>();
    if (string.IsNullOrEmpty(argument)) return dict;
    // Windows App SDK may use either '&' or ';' as separator; also handle raw "key=val;key2=val2" or just "key;key2" (key-only).
    var pairs = argument.Split(new[] { '&', ';' }, StringSplitOptions.RemoveEmptyEntries);
    foreach (var pair in pairs)
    {
        var parts = pair.Split('=', 2);
        if (parts.Length == 2)
            dict[Uri.UnescapeDataString(parts[0])] = Uri.UnescapeDataString(parts[1]);
        else if (parts.Length == 1)
            dict[Uri.UnescapeDataString(parts[0])] = "";
    }
    return dict;
}

static async Task WriteResponse(HttpListenerResponse response, string body)
{
    response.ContentType = "application/json";
    var buffer = Encoding.UTF8.GetBytes(body);
    response.ContentLength64 = buffer.Length;
    await response.OutputStream.WriteAsync(buffer);
    response.OutputStream.Close();
}

static AppNotificationBuilder BuildNotification(NotifyParams notifyParams)
{
    var kind = string.IsNullOrWhiteSpace(notifyParams.Kind)
        ? !string.IsNullOrWhiteSpace(notifyParams.ApprovalId) ? "approval" : "system"
        : notifyParams.Kind;

    if (kind == "approval")
    {
        var localPort = (notifyParams.LocalAgentCallbackPort ?? 3399).ToString();
        return new AppNotificationBuilder()
            .AddText(notifyParams.Title ?? "Oracle Amigo - File request approval")
            .AddText($"{notifyParams.RequesterName ?? "Remote user"} requested: {notifyParams.RequestedItem ?? notifyParams.Body ?? "File request"}")
            .AddText($"Candidate: {notifyParams.TopCandidateFileName ?? "Selected file"}")
            .AddTextBox("feedback", "Feedback (optional)", "Type correction feedback")
            .AddButton(new AppNotificationButton("Approve")
                .AddArgument("action", "approve")
                .AddArgument("kind", "approval")
                .AddArgument("approval_id", notifyParams.ApprovalId ?? "")
                .AddArgument("candidate_id", notifyParams.CandidateId ?? "")
                .AddArgument("task_id", notifyParams.TaskId ?? "")
                .AddArgument("nonce", notifyParams.CallbackNonce ?? "")
                .AddArgument("signature", notifyParams.CallbackSignature ?? "")
                .AddArgument("local_port", localPort))
            .AddButton(new AppNotificationButton("Reject")
                .AddArgument("action", "reject")
                .AddArgument("kind", "approval")
                .AddArgument("approval_id", notifyParams.ApprovalId ?? "")
                .AddArgument("task_id", notifyParams.TaskId ?? "")
                .AddArgument("nonce", notifyParams.CallbackNonce ?? "")
                .AddArgument("signature", notifyParams.CallbackSignature ?? "")
                .AddArgument("local_port", localPort))
            .AddButton(new AppNotificationButton("Send feedback")
                .AddArgument("action", "feedback")
                .AddArgument("kind", "approval")
                .AddArgument("approval_id", notifyParams.ApprovalId ?? "")
                .AddArgument("task_id", notifyParams.TaskId ?? "")
                .AddArgument("nonce", notifyParams.CallbackNonce ?? "")
                .AddArgument("signature", notifyParams.CallbackSignature ?? "")
                .AddArgument("local_port", localPort)
                .SetInputId("feedback"));
    }

    var builder = new AppNotificationBuilder()
        .AddText(notifyParams.Title ?? "Oracle Amigo")
        .AddText(notifyParams.Body ?? "New notification");

    if (!string.IsNullOrWhiteSpace(notifyParams.ConversationId) || !string.IsNullOrWhiteSpace(notifyParams.MessageId))
    {
        builder.AddButton(new AppNotificationButton("Open chat")
            .AddArgument("action", "open_chat")
            .AddArgument("kind", kind)
            .AddArgument("conversation_id", notifyParams.ConversationId ?? "")
            .AddArgument("message_id", notifyParams.MessageId ?? ""));
    }

    return builder;
}

internal record NotifyParams(
    string? Kind,
    string? NotificationId,
    string? Title,
    string? Body,
    string? ConversationId,
    string? MessageId,
    string? ApprovalId,
    string? TaskId,
    string? CandidateId,
    string? CallbackNonce,
    string? CallbackSignature,
    string? RequesterName,
    string? RequestedItem,
    string? TopCandidateFileName,
    int? LocalAgentCallbackPort
);
