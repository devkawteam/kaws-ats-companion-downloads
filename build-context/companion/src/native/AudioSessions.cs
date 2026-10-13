// Windows per-app audio sessions (the same thing the Windows Volume Mixer shows), via Core Audio COM.
// Used by appMixer.js through a PowerShell host: list sessions with peak levels, set volume, mute.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace KawAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
  }

  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }

  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    // IAudioSessionControl
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid ctx);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid ctx);
    [PreserveSig] int GetGroupingParam(out Guid param);
    [PreserveSig] int SetGroupingParam(ref Guid param, ref Guid ctx);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    // IAudioSessionControl2
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference(bool optOut);
  }

  [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute(bool mute, ref Guid ctx);
    [PreserveSig] int GetMute(out bool mute);
  }

  [Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioMeterInformation {
    [PreserveSig] int GetPeakValue(out float peak);
  }

  public static class Sessions {
    static Guid ctx = Guid.Empty;

    static List<IAudioSessionControl2> All() {
      var list = new List<IAudioSessionControl2>();
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
      IMMDevice dev;
      int hr = en.GetDefaultAudioEndpoint(0 /* eRender */, 1 /* eMultimedia */, out dev);
      if (hr != 0 || dev == null) throw new Exception("No playback device found");
      Guid iid = typeof(IAudioSessionManager2).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out o));
      var mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator se;
      Marshal.ThrowExceptionForHR(mgr.GetSessionEnumerator(out se));
      int n; se.GetCount(out n);
      for (int i = 0; i < n; i++) { IAudioSessionControl2 c; if (se.GetSession(i, out c) == 0 && c != null) list.Add(c); }
      return list;
    }

    static string Esc(string s) {
      var b = new StringBuilder();
      foreach (char ch in s ?? "") { if (ch == '"' || ch == '\\') b.Append('\\').Append(ch); else if (ch < 32) b.Append(' '); else b.Append(ch); }
      return b.ToString();
    }

    // JSON array: [{"pid":1,"process":"amtrucks","title":"...","volume":0.8,"muted":false,"peak":0.12,"state":1}]
    public static string List() {
      var sb = new StringBuilder("[");
      bool first = true;
      foreach (var c in All()) {
        uint pid; c.GetProcessId(out pid);
        if (pid == 0 || c.IsSystemSoundsSession() == 0) continue;
        string proc = "", title = "";
        try { var p = Process.GetProcessById((int)pid); proc = p.ProcessName; title = p.MainWindowTitle; } catch { continue; }
        int state; c.GetState(out state);
        float vol = 1, peak = 0; bool mute = false;
        var v = c as ISimpleAudioVolume; if (v != null) { v.GetMasterVolume(out vol); v.GetMute(out mute); }
        var m = c as IAudioMeterInformation; if (m != null) m.GetPeakValue(out peak);
        if (!first) sb.Append(',');
        first = false;
        sb.Append("{\"pid\":").Append(pid).Append(",\"process\":\"").Append(Esc(proc)).Append("\",\"title\":\"").Append(Esc(title))
          .Append("\",\"volume\":").Append(vol.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture))
          .Append(",\"muted\":").Append(mute ? "true" : "false")
          .Append(",\"peak\":").Append(peak.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture))
          .Append(",\"state\":").Append(state).Append('}');
      }
      return sb.Append(']').ToString();
    }

    // Applies to every session of the process (Chrome and Discord open several).
    public static int Set(string process, float volume, int mute) {
      int changed = 0;
      foreach (var c in All()) {
        uint pid; c.GetProcessId(out pid);
        string proc;
        try { proc = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
        if (!string.Equals(proc, process, StringComparison.OrdinalIgnoreCase)) continue;
        var v = c as ISimpleAudioVolume; if (v == null) continue;
        if (volume >= 0) v.SetMasterVolume(Math.Max(0f, Math.Min(1f, volume)), ref ctx);
        if (mute >= 0) v.SetMute(mute == 1, ref ctx);
        changed++;
      }
      return changed;
    }
  }
}
