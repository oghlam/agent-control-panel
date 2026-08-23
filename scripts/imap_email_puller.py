#!/usr/bin/env python3
"""
Agent Control Plane - Real-time IMAP Email Ingestion Puller
This script connects to a real IMAP mail server (Gmail, Outlook, or private company mail),
fetches the latest 5-10 emails, and feeds them directly into the FastAPI Inbound Webhook.
"""

import sys
import imaplib
import email
from email.header import decode_header
import requests

# Default ACP API endpoint
API_URL = "http://localhost:8080/api/webhooks/inbound-email"

def clean_text(header_val):
    if not header_val:
        return ""
    decoded, encoding = decode_header(header_val)[0]
    if isinstance(decoded, bytes):
        return decoded.decode(encoding or "utf-8", errors="ignore")
    return str(decoded)

def main():
    print("=" * 60)
    print("  AGENT CONTROL PLANE - IMAP EMAIL INGESTION WORKER")
    print("=" * 60)
    
    # Prompt credentials safely
    imap_server = input("IMAP Server (e.g. imap.gmail.com or mail.company.com): ").strip()
    if not imap_server:
        print("Error: IMAP server is required.")
        return
        
    email_user = input("Email Address: ").strip()
    import getpass
    email_pass = getpass.getpass("Password / App Password: ").strip()
    
    limit_str = input("Max emails to fetch (default: 5): ").strip()
    limit = int(limit_str) if limit_str.isdigit() else 5

    try:
        print(f"\n[+] Connecting securely to {imap_server} (SSL)...")
        mail = imaplib.IMAP4_SSL(imap_server)
        
        print("[+] Logging in...")
        mail.login(email_user, email_pass)
        
        print("[+] Selecting INBOX...")
        mail.select("INBOX")
        
        # Search for all emails
        status, messages = mail.search(None, "ALL")
        if status != "OK":
            print("[-] Failed to search emails.")
            return
            
        mail_ids = messages[0].split()
        total_found = len(mail_ids)
        print(f"[+] Total emails in INBOX: {total_found}")
        
        if total_found == 0:
            print("[*] INBOX is empty. No emails to ingest.")
            return

        # Get the latest 'limit' email IDs
        target_ids = mail_ids[-limit:]
        print(f"[*] Fetching and processing the latest {len(target_ids)} emails...\n")
        
        success_count = 0
        for mail_id in reversed(target_ids):
            status, data = mail.fetch(mail_id, "(RFC822)")
            if status != "OK":
                continue
                
            raw_email = data[0][1]
            msg = email.message_from_bytes(raw_email)
            
            # Decode Subject & Sender
            subject = clean_text(msg.get("Subject"))
            sender = clean_text(msg.get("From"))
            
            # Extract plain text body
            body = ""
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    content_disp = str(part.get("Content-Disposition"))
                    if content_type == "text/plain" and "attachment" not in content_disp:
                        payload = part.get_payload(decode=True)
                        body = payload.decode(errors="ignore") if payload else ""
                        break
            else:
                payload = msg.get_payload(decode=True)
                body = payload.decode(errors="ignore") if payload else ""
                
            # Limit body length for payload brevity
            body_summary = body[:300] + "..." if len(body) > 300 else body
            
            print("-" * 50)
            print(f"SENDER  : {sender}")
            print(f"SUBJECT : {subject}")
            print(f"BODY    : {body_summary.strip()[:100]}...")
            
            # POST payload to the FastAPI Control Plane Webhook
            payload = {
                "sender": sender,
                "subject": subject,
                "body": body_summary.strip()
            }
            
            try:
                res = requests.post(API_URL, json=payload)
                if res.status_code == 201:
                    print("[✓] Ingested successfully into Control Plane queue!")
                    success_count += 1
                else:
                    print(f"[✕] Failed to ingest. Control Plane API returned status: {res.status_code}")
            except Exception as e:
                print(f"[✕] Error posting to Control Plane API: {e}")
                
        print("\n" + "=" * 60)
        print(f"COMPLETED: Successfully ingested {success_count} emails into the Control Plane.")
        print("=" * 60)
        
        mail.close()
        mail.logout()
        
    except Exception as e:
        print(f"\n[-] Critical Connection Error: {e}")

if __name__ == "__main__":
    main()
