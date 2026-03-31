// Test: search for old article about conference
async function main() {
  const q = "افتتاح المؤتمر التأسيسي الأول لمسرحة الشعائر الحسينية";
  console.log("Question:", q);
  console.log("Sending to chatbot...\n");
  
  const res = await fetch("http://localhost:3000/api/chat/site", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: q }],
      use_tools: true
    })
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:\n", text);
}

main().catch(console.error);
