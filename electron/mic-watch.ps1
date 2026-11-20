# Quién está grabando del micrófono ahora mismo, según el propio audio de Windows
# (las sesiones activas de cada micro). Lo arranca call-detector.cjs y se queda
# en marcha: compilar el C# cuesta medio segundo y no se paga en cada lectura.
# Escribe una línea "MIC chrome.exe|zoom.exe" cada segundo y medio.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class MicWatch {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection {
    int GetCount(out int count);
    int Item(int index, out IMMDevice device);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
    int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }
  [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }
  [Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName(IntPtr p);
    int SetDisplayName(IntPtr a, IntPtr b);
    int GetIconPath(IntPtr p);
    int SetIconPath(IntPtr a, IntPtr b);
    int GetGroupingParam(IntPtr p);
    int SetGroupingParam(IntPtr a, IntPtr b);
    int RegisterAudioSessionNotification(IntPtr p);
    int UnregisterAudioSessionNotification(IntPtr p);
    int GetSessionIdentifier(IntPtr p);
    int GetSessionInstanceIdentifier(IntPtr p);
    int GetProcessId(out uint pid);
  }

  // PIDs con una sesión ACTIVA (state 1) en algún micrófono.
  public static List<uint> ActivePids() {
    var pids = new List<uint>();
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDeviceCollection col;
    en.EnumAudioEndpoints(1, 1, out col); // eCapture, DEVICE_STATE_ACTIVE
    int n; col.GetCount(out n);
    var iid = typeof(IAudioSessionManager2).GUID;
    for (int i = 0; i < n; i++) {
      IMMDevice dev; col.Item(i, out dev);
      object o; dev.Activate(ref iid, 23, IntPtr.Zero, out o);
      var mgr = (IAudioSessionManager2)o;
      IAudioSessionEnumerator se; mgr.GetSessionEnumerator(out se);
      int m; se.GetCount(out m);
      for (int j = 0; j < m; j++) {
        IAudioSessionControl2 s; se.GetSession(j, out s);
        int st; s.GetState(out st);
        uint pid; s.GetProcessId(out pid);
        if (st == 1 && pid != 0 && !pids.Contains(pid)) pids.Add(pid);
        Marshal.ReleaseComObject(s);
      }
      Marshal.ReleaseComObject(se); Marshal.ReleaseComObject(mgr); Marshal.ReleaseComObject(dev);
    }
    Marshal.ReleaseComObject(col); Marshal.ReleaseComObject(en);
    return pids;
  }
}
'@
$once = $args -contains '--once'
while ($true) {
  $names = @()
  try {
    foreach ($procId in [MicWatch]::ActivePids()) {
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($p) { $names += ($p.ProcessName.ToLower() + '.exe') }
    }
    [Console]::Out.WriteLine('MIC ' + (($names | Select-Object -Unique) -join '|'))
  } catch {
    [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
  }
  [Console]::Out.Flush()
  if ($once) { break }
  Start-Sleep -Milliseconds 1500
}
