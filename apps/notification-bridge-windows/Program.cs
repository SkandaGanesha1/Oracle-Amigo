using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

const string AUMID = "OracleAmigo.NotificationBridge";
const string DISPLAY_NAME = "Oracle Amigo Agent";
const string ICON_PATH = ""; // could be set to an .ico file path

void Log(string msg)
{
    var line = $"[bridge] {msg}";
    Console.Error.WriteLine(line);
    try { System.IO.File.AppendAllText(@"C:\Users\Skanda Ganesha L\Temp\opencode\bridge-debug.log", $"{DateTime.Now:HH:mm:ss.fff} {line}\n"); } catch { }
}

Log("=== Bridge starting ===");
Log($"Process ID: {Environment.ProcessId}");
Log($"AUMID: {AUMID}");

var port = Environment.GetEnvironmentVariable("NOTIFICATION_BRIDGE_PORT") ?? "3400";
Log($"Step 1: Starting HttpListener on port {port}");
var listener = new HttpListener();
listener.Prefixes.Add($"http://127.0.0.1:{port}/");
try
{
    listener.Start();
    Log("HttpListener started");
}
catch (Exception ex)
{
    Log($"HttpListener.Start FAILED: {ex.Message}");
    throw;
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
        var approvalId = argsDict.GetValueOrDefault("approval_id", "");
        var taskId = argsDict.GetValueOrDefault("task_id", "");
        var candidateId = argsDict.GetValueOrDefault("candidate_id", "");
        var feedback = "";
        if (args.UserInput != null && args.UserInput.TryGetValue("feedback", out var f))
        {
            feedback = f;
        }

        var localPort = Environment.GetEnvironmentVariable("LOCAL_AGENT_PORT") ?? "3399";
        var callbackPayload = new Dictionary<string, object?>
        {
            ["approvalId"] = approvalId,
            ["taskId"] = taskId,
            ["action"] = action,
            ["feedback"] = feedback,
            ["candidateId"] = candidateId,
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
        }
        catch (Exception ex)
        {
            Log($"[toast] Callback FAILED: {ex.Message}");
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
            var builder = new AppNotificationBuilder()
                .AddText("Oracle Amigo - File request approval")
                .AddText($"{notifyParams.RequesterName} requested: {notifyParams.RequestedItem}")
                .AddText($"Candidate: {notifyParams.TopCandidateFileName}")
                .AddTextBox("feedback", "Feedback (optional)", "Type correction feedback")
                .AddButton(new AppNotificationButton("Approve")
                    .AddArgument("action", "approve")
                    .AddArgument("approval_id", notifyParams.ApprovalId ?? "")
                    .AddArgument("candidate_id", notifyParams.CandidateId ?? "")
                    .AddArgument("task_id", notifyParams.TaskId ?? ""))
                .AddButton(new AppNotificationButton("Reject")
                    .AddArgument("action", "reject")
                    .AddArgument("approval_id", notifyParams.ApprovalId ?? "")
                    .AddArgument("task_id", notifyParams.TaskId ?? ""))
                .AddButton(new AppNotificationButton("Send feedback")
                    .AddArgument("action", "feedback")
                    .AddArgument("approval_id", notifyParams.ApprovalId ?? "")
                    .AddArgument("task_id", notifyParams.TaskId ?? "")
                    .SetInputId("feedback"));

            var toast = builder.BuildNotification();
            toast.Tag = notifyParams.ApprovalId ?? "default";
            toast.Group = "approvals";

            notificationManager ??= AppNotificationManager.Default;
            notificationManager.Show(toast);
            Log($"[notify] Toast SHOWN for approval={notifyParams.ApprovalId}");

            var okBody = JsonSerializer.Serialize(new
            {
                supported = true,
                aumid = AUMID,
                approvalId = notifyParams.ApprovalId
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

internal record NotifyParams(
    string ApprovalId,
    string TaskId,
    string CandidateId,
    string RequesterName,
    string RequestedItem,
    string TopCandidateFileName,
    int LocalAgentCallbackPort
);
