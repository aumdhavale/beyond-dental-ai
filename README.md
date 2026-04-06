🦷 Beyond Dental Health — AI Voice Receptionist

An AI-powered voice + chat-based dental receptionist that can book, manage, and handle patient appointments in real-time, simulating a real clinic front-desk experience with intelligent conversation flow.

🚀 Features

🎙️ Voice + Text Interaction using Web Speech API
📅 Step-by-step conversational appointment booking
🧠 Smart returning patient handling using Patient ID (PAT ID) or phone number
🔁 Cancel and reschedule appointments
⚡ Emergency detection (pain, bleeding, swelling, etc.)
💬 Human-like conversational responses
📊 Live dashboard with chat UI and appointment tracking
🧾 Data persistence using localStorage / JSON

🧠 How It Works

User speaks or types input
System detects intent (booking / cancel / recall / general queries)
A Finite State Machine (FSM) controls the conversation step-by-step
Patient data is stored and reused for faster interactions
Voice + UI respond in real-time with proper turn-taking

🛠️ Tech Stack

Frontend: HTML, CSS, JavaScript
Voice: Web Speech API (SpeechRecognition + SpeechSynthesis)
Backend (optional): Python (voice_agent.py)
AI Integration: Groq API (LLaMA models)
Storage: localStorage and JSON

📂 Project Structure

index.html — main UI
style.css — styling system (glassmorphism UI)
app.js — core logic, FSM, and conversation engine
voice_agent.py — backend voice agent (optional)
appointments.json — appointment storage
patients.json — patient records

▶️ How to Run

Clone the repository
Open terminal in project folder
Run: python -m http.server 3456
Open browser → http://localhost:3456

🔐 Environment Setup (IMPORTANT)

Do NOT hardcode API keys.
Set environment variable like:

set GROQ_API_KEY=your_key_here

🎯 Key Highlights

✅ Full conversational booking system (like real receptionist)
✅ Remembers returning patients using PAT ID
✅ Converts voice inputs like
“aum at gmail dot com” → aum@gmail.com

✅ Handles queries like
time, date, appointment recall
✅ Real-time sync between voice + UI
✅ Handles interruptions and maintains flow

🚧 Future Improvements

🌐 Deploy backend using Node.js / FastAPI
📅 Google Calendar integration for real bookings
🔐 Patient authentication system
🧠 Better NLP for Indian names & accents
📊 Advanced analytics dashboard
☎️ Real phone call integration (Twilio)

👨‍💻 Author
Aum Dhavale

⭐ If you like this project, give it a star on GitHub!
