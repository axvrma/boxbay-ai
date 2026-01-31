using UnityEngine;
using System.Collections;

public class CraneController : MonoBehaviour
{
    [Header("Simulation Settings")]
    public Transform transferTray;
    public float moveSpeed = 5.0f;

    [Header("Physics Constants")]
    public float liftEfficiency = 0.85f;
    public float regenEfficiency = 0.65f;
    public float gravity = 9.81f;

    // --- SCENARIO 1: INBOUND (Tray -> Grid) ---
    public void MoveToSlot(string slotID, float weightTons)
    {
        Vector3 targetPos = DecodeSlotID(slotID);
        StartCoroutine(PerformMove(transferTray.position, targetPos, weightTons, "INBOUND"));
    }

    // --- SCENARIO 2: OUTBOUND (Grid -> Tray) ---
    public void RetrieveFromSlot(string slotID)
    {
        Vector3 targetSlotPos = DecodeSlotID(slotID);
        // Default weight for retrieval demo (e.g., 20 tons) since we didn't save it in Unity memory
        float demoWeight = 20.0f;

        StartCoroutine(PerformMove(targetSlotPos, transferTray.position, demoWeight, "OUTBOUND"));
    }

    IEnumerator PerformMove(Vector3 startPos, Vector3 endPos, float weightTons, string type)
    {
        Debug.Log($"🚀 Starting {type} Move...");

        // 1. Teleport to Start Position (just to be safe for the demo)
        transform.position = startPos;
        yield return new WaitForSeconds(0.5f); // Small pause before moving

        // 2. Move to Destination
        float distance = Vector3.Distance(startPos, endPos);
        float duration = distance / moveSpeed;
        float elapsed = 0;

        while (elapsed < duration)
        {
            transform.position = Vector3.Lerp(startPos, endPos, elapsed / duration);
            elapsed += Time.deltaTime;
            yield return null;
        }
        transform.position = endPos;

        // 3. Calculate Physics (Net Energy)
        CalculateEnergy(startPos, endPos, weightTons);
    }

    void CalculateEnergy(Vector3 start, Vector3 end, float weightTons)
    {
        float heightDiff = end.y - start.y;
        float massKg = weightTons * 1000;
        float energyUsed = 0;
        float regen = 0;

        if (heightDiff > 0) // Lifting
             energyUsed = (massKg * gravity * heightDiff) / liftEfficiency;
        else // Lowering (Regen)
             regen = (massKg * gravity * Mathf.Abs(heightDiff)) * regenEfficiency;

        // Convert Joules to kWh
        float kwhUsed = energyUsed * 2.77778e-7f;
        float kwhRegen = regen * 2.77778e-7f;
        float netKwh = kwhUsed - kwhRegen;

        Debug.Log($"🏁 {weightTons}t Move Complete. Net Energy: {netKwh:F4} kWh (Used: {kwhUsed:F4}, Regen: {kwhRegen:F4})");
    }

    Vector3 DecodeSlotID(string slotID)
    {
        if (slotID.Contains("Tier:1")) return new Vector3(2, 1.5f, 0);
        if (slotID.Contains("Tier:3")) return new Vector3(2, 6.0f, 0);
        if (slotID.Contains("Tier:5")) return new Vector3(2, 10.0f, 0);
        if (slotID.Contains("Tier:8")) return new Vector3(2, 16.0f, 0);
        if (slotID.Contains("Tier:11")) return new Vector3(2, 22.0f, 0);
        return new Vector3(5, 5, 0);
    }
}