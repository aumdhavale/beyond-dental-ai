import os
import time
import speech_recognition as sr
from openai import OpenAI
import json
import re
import pyttsx3

engine = pyttsx3.init('sapi5')
engine.setProperty('rate', 160)
engine.setProperty('volume', 1.0)

last_appointment = {}

def clean_email(text):
    text = text.lower().strip()

    # Replace spoken words
    text = text.replace(" at ", "@")
    text = text.replace(" dot ", ".")
    text = text.replace(" underscore ", "_")
    text = text.replace(" dash ", "-")
    text = text.replace(" space ", "")

    # Remove spaces
    text = text.replace(" ", "")

    return text

def speak(text):
    print(f"\n🦷 Receptionist: {text}")
    engine.say(text)
    engine.runAndWait()

def listen():
    recognizer = sr.Recognizer()
    with sr.Microphone() as source:
        print("\n[Listening... Speak now]")
        recognizer.adjust_for_ambient_noise(source, duration=0.5)
        try:
            audio = recognizer.listen(source, timeout=5, phrase_time_limit=10)
            text = recognizer.recognize_google(audio)
            print(f"👤 Patient: {text}")
            return text.lower()
        except:
            print("[Could not understand audio]")
            return ""
system_prompt = """
You are a professional and friendly voice AI receptionist for "Beyond Dental Health".

Your job:
- Answer questions
- Book appointments step-by-step
- Collect patient details

STRICT RULES:
- Ask ONLY one question at a time
- Keep answers short (1-2 sentences)
- Guide conversation step-by-step

BOOKING FLOW (strict order):
1. new or existing patient
2. full name
3. phone number
4. email
5. date
6. time
7. reason

IMPORTANT:
When enough booking info is collected, return data in JSON format like this:

{
  "intent": "booking",
  "name": "",
  "phone": "",
  "email": "",
  "date": "",
  "time": "",
  "reason": ""
}

Otherwise respond normally.
Do NOT ask for information that is already provided earlier in the conversation.
Never reset the conversation.
Always continue from previous context.
If you asked for name, do not ask again.
Always proceed step-by-step in booking flow.

If user gives a valid answer (like name, phone, etc.), acknowledge it briefly and move to next step.

EMERGENCY:
If user says pain, bleeding, broken tooth:
Say it's urgent and start booking immediately.
"""
booking_data = {
    "patient_type": "",
    "name": "",
    "phone": "",
    "email": "",
    "date": "",
    "time": "",
    "reason": ""
}
current_step = "start"

def save_appointment(data):
    with open("appointments.json", "a") as f:
        json.dump(data, f)
        f.write("\n")

def chat_with_agent():
    global booking_data, current_step, last_appointment
    api_key = os.environ.get("GROQ_API_KEY")

    if not api_key:
        print("❌ GROQ_API_KEY not set. Please set it in environment variables.")
        return  
    client = OpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1"
    )

    messages = [
        {"role": "system", "content": system_prompt}
    ]

    greeting = "Thank you for calling Beyond Dental Health. How can I help you today?"
    speak(greeting)
    messages.append({"role": "assistant", "content": greeting})

    while True:
        user_input = listen()
        user_input = user_input.lower()

        if not user_input:
            speak("Sorry, I didn’t catch that. Could you please repeat?")
            continue

        if any(word in user_input.lower() for word in ["bye", "goodbye", "exit", "stop"]):
            speak("Thank you for calling Beyond Dental Health. Have a great day!")
            break

        if user_input.strip() == "tomorrow":
            from datetime import datetime, timedelta
            tomorrow = (datetime.now() + timedelta(days=1)).strftime("%d %B %Y")
            speak(f"Tomorrow's date is {tomorrow}.")
            continue

        # 🔥 Handle appointment query ONLY when asking about existing appointment
        if ("when" in user_input or "my appointment" in user_input) and last_appointment:
            speak(f"Your appointment is on {last_appointment['date']} at {last_appointment['time']}.")
            continue


        if any(word in user_input for word in ["pain", "bleeding", "broken", "swelling"]):
            speak("This sounds urgent. I'll make sure you get the earliest available appointment.")

            # 🔥 DO NOT break flow if already in booking
            if current_step == "start":
                speak("Are you a new or existing patient?")
                current_step = "patient_type"

            # ❗ DO NOT continue blindly

        # 🔥 CONTROLLED BOOKING FLOW
        if current_step == "start":
            if "book" in user_input or "appointment" in user_input:
                speak("Are you a new or existing patient?")
                current_step = "patient_type"
                continue

        elif current_step == "patient_type":
            booking_data["patient_type"] = user_input
            speak("May I have your full name?")
            current_step = "name"
            continue

        elif current_step == "name":
            booking_data["name"] = user_input
            speak("Please share your phone number.")
            current_step = "phone"
            continue

        elif current_step == "phone":
            booking_data["phone"] = user_input
            speak("Could you provide your email address?")
            current_step = "email"
            continue

        elif current_step == "email":
            cleaned_email = clean_email(user_input)

            if "@" not in cleaned_email or "." not in cleaned_email:
                speak("Please provide a valid email address.")
                continue

            booking_data["email"] = cleaned_email

            speak("What date would you prefer?")
            current_step = "date"
            continue

        elif current_step == "date":
            booking_data["date"] = user_input
            speak("What time works best for you?")
            current_step = "time"
            continue

        elif current_step == "time":
            booking_data["time"] = user_input
            speak("What is the reason for your visit?")
            current_step = "reason"
            continue

        elif current_step == "reason":
            booking_data["reason"] = user_input

            save_appointment(booking_data)
            last_appointment = booking_data.copy()

            speak(f"Your appointment is confirmed for {booking_data['date']} at {booking_data['time']}.")
    
    
            speak("Is there anything else I can help you with?")

            # 🔥 RESET EVERYTHING
            booking_data = {
                "patient_type": "",
                "name": "",
                "phone": "",
                "email": "",
                "date": "",
                "time": "",
                "reason": ""
            }

            current_step = "start"
            continue


        if "date" in user_input:
            from datetime import datetime, timedelta

            if "tomorrow" in user_input:
                tomorrow = (datetime.now() + timedelta(days=1)).strftime("%d %B %Y")
                speak(f"Tomorrow's date is {tomorrow}.")
            else:
                today = datetime.now().strftime("%d %B %Y")
                speak(f"Today's date is {today}.")
            continue

        if "time" in user_input and "appointment" not in user_input:
            from datetime import datetime
            now = datetime.now().strftime("%I:%M %p")
            speak(f"The current time is {now}.")
            continue

        # 🔥 Handle services locally
        if "service" in user_input.lower():
            speak("We offer general dentistry, cosmetic treatments, restorative procedures, and emergency dental care.")
            continue

        # 🧠 GPT only for general queries
        messages.append({"role": "user", "content": user_input})

        if client and current_step == "start":
            try:
                response = client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=messages,
                    max_tokens=150,
                    temperature=0.7
                )

                reply = response.choices[0].message.content

            except Exception as e:
                reply = "I'm sorry, I'm having trouble connecting right now."
                print(f"[API Error: {e}]")
        else:
            reply = "Could you please clarify your request so I can assist you better?"
        messages.append({"role": "assistant", "content": reply})
        speak(reply)

if __name__ == "__main__":
    print("\n" + "="*50)
    print("Starting Beyond Dental Health Voice Agent...")
    print("Make sure your microphone is connected and working.")
    print("Say 'bye' or 'exit' to stop the agent.")
    print("="*50)
    try:
        chat_with_agent()
    except KeyboardInterrupt:
        print("\nAgent stopped by user.")
