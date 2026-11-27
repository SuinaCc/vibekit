using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

// Tiny persistent key-injection helper for the phone remote plugin.
// It reads ASCII commands from stdin and replies with OK/ERR on stdout:
//   K d:17:0;d:86:0;s:30;u:86:0;u:17:0
//   Q  (quit)
// Keeping the process alive removes the per-key PowerShell startup delay.
public static class VibeKeys
{
    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public static int Main(string[] args)
    {
        int parentPid = 0;
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--parent") int.TryParse(args[i + 1], NumberStyles.Integer, CultureInfo.InvariantCulture, out parentPid);
        }
        if (parentPid > 0)
        {
            // If the Electron main process is force-killed, stdin may stay open
            // briefly (or forever). Exit shortly after the parent disappears so
            // the .exe is not left locked for the next app launch.
            var watchdog = new Thread(() =>
            {
                while (true)
                {
                    Thread.Sleep(2000);
                    try
                    {
                        var parent = Process.GetProcessById(parentPid);
                        if (parent.HasExited) break;
                    }
                    catch
                    {
                        break;
                    }
                }
                Environment.Exit(0);
            });
            watchdog.IsBackground = true;
            watchdog.Start();
        }

        Console.Out.WriteLine("READY");
        Console.Out.Flush();

        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (line == "Q") break;
            if (line.StartsWith("K ", StringComparison.Ordinal))
            {
                try
                {
                    Execute(line.Substring(2));
                    Console.Out.WriteLine("OK");
                }
                catch (Exception ex)
                {
                    Console.Out.WriteLine("ERR " + ex.Message.Replace('\n', ' ').Replace('\r', ' '));
                }
            }
            else
            {
                Console.Out.WriteLine("ERR unknown");
            }
            Console.Out.Flush();
        }
        return 0;
    }

    private static void Execute(string payload)
    {
        foreach (var token in payload.Split(';'))
        {
            if (token.Length == 0) continue;
            var parts = token.Split(':');
            if (parts.Length < 2) throw new FormatException("bad token");
            switch (parts[0])
            {
                case "d":
                    Press(byte.Parse(parts[1], CultureInfo.InvariantCulture), parts.Length > 2 && parts[2] == "1", false);
                    break;
                case "u":
                    Press(byte.Parse(parts[1], CultureInfo.InvariantCulture), parts.Length > 2 && parts[2] == "1", true);
                    break;
                case "s":
                    Thread.Sleep(Math.Max(0, Math.Min(5000, int.Parse(parts[1], CultureInfo.InvariantCulture))));
                    break;
                default:
                    throw new FormatException("bad token");
            }
        }
    }

    private static void Press(byte vk, bool extended, bool up)
    {
        uint flags = 0;
        if (extended) flags |= 0x0001;
        if (up) flags |= 0x0002;
        keybd_event(vk, 0, flags, UIntPtr.Zero);
    }
}
