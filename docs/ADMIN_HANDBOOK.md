# Administrator handbook

For alumni-office staff who run SST Alumni Connect. Every task here is done in the browser — no files or commands.
Open **Administration** from the user menu (staff accounts only). What you see depends on your role.

## 1. First steps after installation
1. Complete the setup wizard (institution, branding, first Super Administrator, email and SMS).
2. **System Configuration → General**: application URL, contact email and phone, address, default language.
3. **Branding**: logos, colours, login background; preview, then publish.
4. **Email (SMTP)** and **SMS**: enter provider details and use *Send test*. Until email works, members cannot verify
   their address or reset passwords.
5. **Security**: password rules, lockout, two-factor policy (require it for staff), allowed file types and upload size.
6. **Roles & Permissions**: give each colleague the narrowest role that fits (see §12).

## 2. Alumni and verification
- **Alumni Management**: search, filter, open profiles, edit verified details, export CSV.
- **Alumni Verification**: the queue of new registrations. Each shows any matching school record. Approve, ask for
  more information, or reject with a reason (the member is emailed). Issue verification codes for people you
  verify in person.
- **School records**: import the school's student list (CSV) so registrations are matched automatically.
- **Batch Management**: create classes, or generate a range of years; members are assigned automatically.
- **Privacy Requests**: members' account-deletion requests. *Delete account* anonymises the person; *Decline* needs a reason.

## 3. Community
**Community Moderation**: reported posts and comments, hide / restore, warnings, discussion groups. Announcements
pinned here appear at the top of everyone's feed.

## 4. Events
**Events Management** → *New event*: date and time, venue or online link (shown only to registered attendees),
capacity (extra registrations join a waitlist), guests per attendee, batch-only events. Publish when ready.
On the day, open the event and use *Check-in* to scan tickets. Afterwards add photos and read feedback.

## 5. Jobs and mentorship
- **Jobs & Internships**: approve or reject jobs posted by members and verified employers; manage categories and
  career resources.
- **Mentorship**: approve mentor applications, follow requests and sessions, read feedback.

## 6. Achievements
Nominations from members arrive here. Approve, then publish. The website shows an achievement only when the member
agreed to public display.

## 7. Donations and scholarships
Donations work without an online payment gateway:
1. **System Configuration → Donations**: bank name, account title, IBAN, other ways to give, instructions.
2. **Donations & Scholarships → Campaigns**: create, open, close campaigns with goals.
3. Members pledge and receive the bank details and a reference. When money arrives, open the donation and
   *Confirm* with the bank or cheque reference → a numbered receipt is emailed and progress updates.
4. Record gifts received offline with *Record offline donation*. Refunds and cancellations are kept in history.
5. **Scholarships**: funds, sponsors and awards (recipients are visible to finance staff only).

## 8. Newsletters and communication
- **Newsletters**: write, preview, send a test, then send now or schedule. Audiences: subscribers, verified alumni
  or one batch. Every issue has a one-click unsubscribe link.
- **Communication Center**: email / SMS / in-app templates (with Urdu versions) and the delivery log.
- **Website Messages**: messages from the website contact form; reply by email and mark as replied.

## 9. Website
- **Website Pages**: *New page*, then add blocks (hero, text, image and text, statistics, events, news, gallery,
  featured alumni, testimonials, call to action, contact, newsletter). Drag to reorder. *Preview* shows the real
  website on desktop, tablet and phone. *Publish* or *Schedule*; edits stay in the draft until you publish again.
- **Website menus** (button on the Pages screen): header and footer links, with Urdu labels.
- **News & Announcements**: articles, announcements and success stories; *members only* keeps an article in the portal.
- **System Configuration → Public website**: home page, footer text, social links, contact form.

## 10. Custom fields and languages
- **Custom Fields**: add questions to registration, profiles, jobs, events, mentor profiles or donations. Choose the
  type, whether it is required, who can see the answers, validation and conditions ("show only when …"). Turning a
  field off hides it but keeps the answers.
- **System Configuration → Languages & translations**: switch languages on or off, add a language, edit any
  interface text, or export / import a CSV for translators. The administration screens stay in English.

## 11. Reports, audit and health
- **Reports & Analytics**: 13 reports with date filters, charts and tables; export CSV, Excel or PDF, or print.
  Reports contain counts only.
- **Audit Logs**: who did what and when (sign-ins, approvals, exports, settings changes, deletions); export CSV.
- **System Health**: database, Redis, queues, failed emails and API response times.

## 12. Roles at a glance
| Role | Typical person | Can |
|---|---|---|
| Super Administrator | IT lead (2 people max) | everything, including roles and integrations |
| System Administrator | IT staff | configuration, users, health — not finance |
| Alumni Administrator / Coordinator | alumni office | members, verification, batches, community |
| Content Editor | communications | website pages, news, gallery, media |
| Event Manager · Career Manager · Mentorship Coordinator | programme leads | their module only |
| Finance / Donation Manager | accounts office | donations, receipts, scholarships, donation settings |
Custom roles can be created from the permission matrix. Staff with administrative access must use two-factor
authentication when the security policy requires it.

## 13. Good practice
- Never share accounts; remove access the day someone leaves (*User Management → Deactivate*).
- Export only what you need, and delete exported files when done — exports are audit-logged.
- Check **Alumni Verification**, **Website Messages** and **Privacy Requests** at least twice a week.
