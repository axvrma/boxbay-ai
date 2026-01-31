using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using UnityEngine;
using SocketIOClient;

public class NetworkManager : MonoBehaviour
{
    public SocketIOUnity socket;
    public CraneController craneController;

    private readonly ConcurrentQueue<Action> _executionQueue = new ConcurrentQueue<Action>();

    void Start()
    {
        var uri = new Uri("http://localhost:3000");
        socket = new SocketIOUnity(uri, new SocketIOOptions
        {
            Transport = SocketIOClient.Transport.TransportProtocol.WebSocket
        });

        socket.OnConnected += (sender, e) =>
        {
            Debug.Log("✅ Connected to Node.js Orchestrator");
            socket.Emit("register", "unity");
        };

        socket.On("inbound_task", (response) =>
        {
            _executionQueue.Enqueue(() =>
            {
                ProcessInboundTask(response);
            });
        });

        // SCENARIO 2: Outbound (GPS)
        socket.On("outbound_task", (response) =>
        {
             _executionQueue.Enqueue(() =>
            {
                // We use the same data class because the structure is similar
                // Node.js sends: { containerId, priority }
                // For the demo, let's hardcode a slot to fetch from, or pass it from Node
                // Let's pretend the box is at 'Tier:11'
                Debug.Log("⚡ PRE-FETCH TRIGGERED! Retrieving container...");
                craneController.RetrieveFromSlot("Grid:1-Row:2-Tier:11");
            });
        });

        socket.Connect();
    }

    void Update()
    {
        while (_executionQueue.TryDequeue(out var action))
        {
            action.Invoke();
        }
    }

    void ProcessInboundTask(SocketIOResponse response)
    {
        try
        {
            // FIX 1: We explicitly ask for the FIRST item (Index 0)
            // This prevents the "Array vs Object" confusion
            var data = response.GetValue<CraneTaskData>(0);

            Debug.Log($"🏗️ Crane Order: Move {data.weight} tons to {data.targetSlot}");
            craneController.MoveToSlot(data.targetSlot, data.weight);
        }
        catch (Exception e)
        {
            // This prints the raw text so we can see what actually arrived if it fails again
            Debug.LogError($"❌ JSON Error: {e.Message} | Raw Data: {response}");
        }
    }

    void OnDestroy()
    {
        if (socket != null)
        {
            socket.Disconnect();
            socket.Dispose();
        }
    }
}

// --- HELPER CLASS ---
[System.Serializable]
public class CraneTaskData
{
    // FIX 2: Added { get; set; }
    // System.Text.Json REQUIRES this to work!
    public string containerId { get; set; }
    public string targetSlot { get; set; }
    public float weight { get; set; }
}