# Portal redesign — notes from the supplied designs (images/connect)

Source images: `D:\SST\images\connect\*.png`. These notes record what each screen needs so the build does not have to
re-read the images. "NEW" = feature or data that does not exist yet.

## Global shell (all portal screens)
- Top bar, navy (#102344), full width, ~64px: shield logo + "SST Public School / Rashidabad" (2 lines, white, semibold) |
  divider | "Alumni Portal". Centre-left: search pill (dark navy, rounded, "Search alumni, posts, groups, events…").
  Right: icon+label tabs Home · Network · Community · Events (active tab = purple filled tile #6D28D9-ish, rounded top);
  bell with purple count badge; chat icon; avatar circle (letter) + chevron.
- Left sidebar (white card, rounded, ~240px): Feed, My Network, Messages (purple count pill), Communities, Events,
  Alumni Directory, Jobs & Opportunities, Mentorship, Resources | divider | Saved Posts, My Profile, Settings.
  Active item: light purple background (#F2ECFF), purple text/icon. Bottom promo card (light purple): "Grow the SST
  Alumni Community" + people illustration + text + outlined purple "Invite Alumni" button (envelope icon). NEW invite.
- Canvas background #F7F8FC, white cards, 12–16px radius, subtle shadow, purple primary buttons.

## Login (default landing page `/`)
- Split: left ~53% campus photo with purple wave overlays at top-right and bottom; bottom-left white text block:
  short purple bar, "SST Alumni Portal" (large bold), "Reconnect • Network • Collaborate • Give Back", 4 icon items
  (Stay Connected, Join Events, Explore Opportunities, Build Communities) separated by thin dividers.
- Right: white rounded card on very light lavender background: shield logo + "SST Public School / Rashidabad" (navy,
  bold) + "— Alumni Portal —" (purple, with lines). "Welcome Back" (large, navy), "Sign in to your Alumni account".
  Email Address (envelope icon, "Enter your email address"); Password label with "Forgot Password?" (purple) right;
  input with lock icon + eye toggle. "Remember me" checkbox (checked, purple). Full-width purple "Sign In".
  (Google / Microsoft buttons: HIDDEN per decision.) "New to the Alumni Portal? Create an Account" (purple bold).
  Footer links: Help & Support | Privacy Policy | Terms of Use.
- After sign-in → Feed.

## Feed (Home) — `SST Alumni Portal Dashboard`
- Centre: "Good morning, {name} 👋" (time-of-day greeting), "Stay connected with the SST Rashidabad alumni community."
- Composer card: avatar + input "Share an update, achievement, opportunity or memory…"; row: Photo, Video, Poll, Event,
  Job (icon+label buttons) + purple "Post" button. Opens the Create Post modal.
- Tabs: All Posts · Following · My Batch · Groups; right "Sort by: Latest ▾" (NEW: following/batch/groups filters, sort).
- Post card: avatar, name + verified badge, "Class of 2010 • Lahore, PK • 2h ago", ⋯ menu; text; media (1 wide image,
  or grid 1 large + 2); reaction icons + count left; "24 comments • 3 shares" right; actions Like · Comment · Share · Save.
- Right column: profile card (campus banner image, avatar overlapping, name, "Alumni • Class of 2015", "View Profile →",
  stats Connections | Groups | Events); Upcoming Events (date tile DEC/12, title, location pin, purple "RSVP"); My Groups
  (thumbnail, name, members count, outlined "Join"); People you may know (avatar, name, class • city, outlined "Connect").

## Create New Post modal
- Title "Create New Post" + ✕. Type tabs: Post · Achievement · Event · Job · Poll · Article (active = light purple pill).
- Author row (avatar, name, "Class of 2015"); right "Share with: Alumni Community ▾" (audience: community / batch /
  group / connections — NEW audience selector).
- Large text area (purple border). Media thumbnails grid with ✕ per item + "Add More Photos / Videos" tile (NEW video).
- Tool row: Photo / Video · Tag People (NEW) · Location (NEW) · Feeling / Activity (NEW).
- Footer: "Add Topics (e.g. Reunion, Campus, Alumni Meet)" tag input (NEW topics); "Save as Draft" (NEW drafts) link;
  purple "Post" with paper-plane icon.

## Post detail / reactions / comments — `SST Alumni Meetup 2026 Social Post`
- Reaction picker on Like hover: Like 👍, Love ❤️, Celebrate 👏, Insightful 💡, Haha 😆, Support 💜.
- Reactions panel (side card): "Reactions (132)" tabs All / per type with counts; list avatar + name + class + type icon.
- Comments (24) with "Most relevant ▾"; comment bubble (light grey) name + verified + class; text; Like · Reply · time;
  reaction count chip; nested replies (indent with connector line), "Author" badge on post author's replies, @mentions
  (purple). "View 8 more comments ▾". Composer: avatar + "Write a comment…" + emoji, image, GIF icons + send.

## My Network — `Alumni Network Dashboard`
- Title "My Network", subtitle "Build, manage and grow your alumni connections.", purple "Find Alumni" button.
- Tabs: Overview · Connections (248) · Requests (5) · Suggestions · Following · Followers.
- Stat tiles: Connections, Mutual Connections, Batches, Groups in Common (icon circle tinted).
- Connection Requests card: horizontal cards (photo, name, class, "12 mutual connections", Accept (purple) / Decline).
- Your Connections table: search "Search your connections…" + Filter; rows avatar, name + verified, class; job
  ("Project Director at IHC"); location; "18 mutual"; outlined "Message"; ⋯.
- Right: "Expand Your Network" illustration card + "Find Alumni"; People You May Know (mutual count + Connect);
  Network Insights list (Total Connections, Connection Requests, People You May Know, Mutual Connections).

## Communities — `Alumni Communities Dashboard`
- Breadcrumb "Community"; title "Communities"; subtitle "Join groups, discuss ideas, share opportunities and stay connected
  with fellow alumni." Hero banner (purple gradient left + campus photo): "Alumni Communities", "Reconnect • Collaborate
  • Grow Together".
- Search bar "Search communities by name or keyword…" with attached purple "+ Create Community".
- "Discover Communities" + "View All Communities →": 4-col card grid: cover image, round icon badge overlapping
  (category icon), name, members count, 2–3 line description, buttons: "Join" (purple) or "✓ Joined" (light purple),
  bell (notifications per group — NEW), ⋯.
- Right: My Communities (count badge; thumb, name, members, outlined "View"); Trending Discussions (topic title +
  comment count — NEW: group discussion threads with counts); Explore by Category chips: Batch Groups, Professional,
  Interest & Hobbies, Career & Jobs, Higher Studies, Social Impact, Events & Reunions (NEW group categories + cover image).
- Left sidebar promo variant: "Join Communities" + "+ Create Community".

## Community detail — `SST Batch of 2010 Community Reunion`
- Wide cover photo; square group photo overlapping bottom-left; name + verified badge; "🔒 Private Community · 428
  members"; buttons: "🔔 Following ▾" (outlined), purple "+ Invite Members", ⋯. Description line.
- Tabs: Discussion · Members · Events · Files · Announcements · About (NEW: files, announcements, group events).
- Composer "Share something with the community…" + Photo/Video, Document (NEW doc posts), Event, Poll.
- "Recent Posts" + "Most Recent ▾"; posts with photo grid "+12" overflow.
- Right: Community Overview (Members, Posts, Events counts); About This Community (description, Privacy, Created date,
  Admins count, "View Details →"); Upcoming Events (thumb, title, date/time, location, RSVP); Community Members avatar
  row "+421" + "View All".

## Alumni Directory — `SST Alumni Directory Dashboard`
- Title "Alumni Directory", subtitle "Search and connect with SST alumni from all batches, professions and locations."
- Search "Search by name, profession, company or keyword…". List rows (white cards): photo with online dot (green /
  grey — presence), name + verified, purple pill "Class of 2010"; "💼 Construction Consultant at BuildTech
  International"; "📍 Karachi, Pakistan"; "48 mutual connections"; purple "Connect", outlined "Message", ⋯.
  Infinite scroll "Loading more alumni…".
- Right Filters card: "Filters" + "Clear All"; accordion sections: Batch / Year (search + checkboxes with counts
  "(286)", "Show More"), Location, Industry, Company, Designation, Country, Community, Verified Profiles (checkbox
  "Verified Profiles Only"); full-width purple "Apply Filters". Stats card: Total Alumni | Verified Profiles.
- Sidebar promo variant: "Explore the Alumni Network" + "Find Alumni".

## Events — `SST Alumni Events Dashboard`
- Breadcrumb "Events"; title + subtitle "Discover and participate in alumni events, reunions, networking sessions and
  school activities."; purple "+ Create Event" (members can create events — NEW member-created events, reviewed?).
- Featured carousel (dots): event cover full width, title, date, location, white "View Details →" (NEW featured flag).
- "All Events" + search "Search events by name, location or keyword…". Row cards: thumbnail, category pill
  (Reunion / Networking / School Event / Webinar), title, 2-line description, date • time, location; right:
  "286 attending", purple "RSVP" or outlined "🔖 Interested" (NEW interested state), ⋯.
- Right: My Events (Upcoming, Attending, Interested, Past Events counts); Upcoming Events (thumb, title, date • city,
  RSVP / Interested); Event Categories chips: Reunions, Networking, Webinars, Career & Jobs, School Events, Workshops,
  Sports & Activities, Social Impact.
- Sidebar promo: "Host an Alumni Event" + "+ Create Event".

## Event detail — `Class of 2010 Reunion Event Details`
- Breadcrumb Events › Event Details. Hero cover with dark gradient: category pill, title, summary.
- Info strip: date + time range; venue (bold) + city; buttons: "Add to Calendar" (ICS — NEW), share, bookmark, ⋯.
- Tabs: Overview · Discussion (24) · Attendees (286) · Photos · Files (NEW event discussion, files).
- Overview: "Event Details" text; highlights row of icon tiles (Reunion & Networking, Dinner & Refreshments, Group
  Photo, Musical Evening, Souvenirs — NEW highlights list); Agenda timeline (time + item, purple dots — NEW agenda);
  Location card with map preview + address + outlined "Get Directions" (link to maps).
- Right: Event Status ("Open for RSVP" green pill; Attending / Interested / Invited counts; purple "✓ RSVP – I'm
  Attending"; outlined "☆ I'm Interested"); Event Organizer (community avatar, name, "Community • 428 members", outlined
  "View Community →" — NEW organiser = community); Attendees avatars "+280" View All; Share this Event + "Copy Event Link".

## Jobs & Opportunities — `Alumni Jobs and Opportunities Dashboard`
- NOTE top nav here has an extra "Jobs" tab between Community and Events (active). Use: Home, Network, Community,
  Jobs, Events.
- Title + subtitle "Discover career opportunities, refer fellow alumni and grow your professional network."; purple
  "+ Post a Job". Hero banner "Alumni Career Network" / "Jobs • Referrals • Internships • Career Growth" + white
  "Explore Jobs →".
- Search "Search jobs by title, company or keyword…"; filter tiles: All Jobs, Full-time, Part-time, Internship,
  Remote, On-site. "112 Job Opportunities".
- Rows: company logo tile, title + type pill, company, location, experience ("5+ years"), "Posted 2 days ago",
  bookmark button, "View Details →". Infinite scroll "Loading more opportunities…".
- Right: My Job Activity (Applications, Saved Jobs, Job Alerts — NEW job alerts); Post a Job card; Career Resources
  links (Resume Builder, Interview Preparation, Career Counseling, Alumni Mentorship); "Refer a Candidate" card +
  "+ Make a Referral" (NEW referrals).
- Sidebar promo: "Hire from the SST Alumni Network" + "+ Post a Job".

## Job detail — `SST Alumni Portal Job Details`
- Breadcrumb Jobs & Opportunities › Job Details. Header card: logo tile, title, company + verified; bookmark, share, ⋯;
  meta row: location, type, experience, posted.
- Body sections (icon headers): Job Overview (paragraph), Key Responsibilities (purple bullets), Requirements
  (bullets), What We Offer (benefit icon tiles: Competitive Salary, Health Insurance, Flexible Work, Learning & Growth,
  Alumni Network). NEW structured fields: responsibilities[], requirements[], benefits[].
- Right: purple "Apply Now ↗" + outlined "Refer a Candidate"; About the Company (logo, name + verified, industry,
  description, Employees "250+", Headquarters, Website — employer profile fields); Posted by an Alumni (avatar with
  presence, name, class, headline, outlined "Message"); Similar Opportunities (logo, title, company, type pill, →).

## Mentorship — `SST Alumni Mentorship Dashboard`
- Title + subtitle "Connect with experienced alumni, get career guidance and give back by mentoring others.";
  purple "+ Become a Mentor". Hero "Alumni Mentorship Program" / "Learn • Guide • Grow • Give Back" + "Find a Mentor →".
- Tabs: Find a Mentor · Find a Mentee (NEW: mentees looking for mentors) · My Mentorships · Sessions · Mentorship
  Requests (badge 2).
- Search "Search by name, area of expertise, company or keyword…"; filter tiles: Mentors, Career Guidance, Higher
  Studies, Industry Insights, Leadership, Entrepreneurship.
- "Recommended Mentors" rows: photo + presence dot, name + verified, class, headline; expertise pills (3); "48
  mentees"; "5+ years mentoring"; outlined "Request Mentorship"; ⋯.
- Right: My Mentorship (Mentor Sessions, As a Mentee, As a Mentor counts); "Request a Mentor" illustration card +
  "Find a Mentor"; Mentorship Categories chips (Career Guidance, Entrepreneurship, Higher Studies, Technology & IT,
  Industry Insights, Management, Leadership, Other); Upcoming Sessions (date tile, title, time, "Online (Zoom)", →).
- Sidebar promo: "Become a Mentor" + "+ Join as a Mentor".

## Resources (NEW module) — `SST Alumni Resource Hub Dashboard`
- Title "Resources", subtitle "A shared knowledge hub for alumni — learning materials, career guides, documents and
  more."; purple "+ Upload Resource" (member uploads; moderation by staff). Hero "Alumni Resource Hub" / "Learn •
  Share • Grow • Support" + "Explore Collections →".
- Search "Search resources by title, keyword or category…"; tabs/chips: All Resources, Career, Higher Studies,
  Scholarships, Guides, Publications, Videos.
- Category tiles (pastel, icon, name, "48 items"): Career Resources, Higher Studies, Scholarships, Alumni Publications,
  School Archives, Forms & Templates.
- Featured Resources rows: file-type tile (PDF/PPT/DOC), title, description, "2,846 downloads", "Updated Nov 20, 2026",
  size; category pill; bookmark; outlined "Download".
- Right: My Resources (My Downloads, Saved Resources, My Uploads counts); Curated Collections (icon, title, subtitle,
  › — e.g. Career Development Pack, Higher Studies Essentials, SST School Archives, Alumni Talks & Webinars);
  Recently Added (file tile, title, date • size).
- Sidebar promo: "Share Knowledge with Alumni" + "+ Upload Resource".

## Messages — `SST Alumni Portal Messages Interface`
- Three columns inside the shell: conversation list card + chat card (no right widget column).
- List: "Messages" + compose (pencil-square) + ⋯; search "Search messages…"; tabs All · Unread (3) · Starred (NEW
  starred conversations); rows: avatar + presence dot, name (bold), last message preview, time/date right, unread purple
  count circle; selected row light purple.
- Chat header: avatar, name + green dot, "● Online", "Class of 2010 • Construction Consultant"; icon buttons: phone,
  video (NEW 1:1 voice / video calls — WebRTC via the gateway), info, ⋯.
- Day separators ("Yesterday", "Today" grey pills). Incoming: light grey bubble left with avatar, time under.
  Outgoing: purple bubble right, white text, time + double tick (read) under. Attachment card inside bubble (PDF icon,
  file name, size, download icon).
- Composer: round "+" button, input "Type a message…" with emoji + paperclip icons, round purple send button.

## My Profile — `Alumni Portal Profile Dashboard`
- Cover photo (NEW cover image) with "Change Cover" white button; large round photo overlapping with camera button.
- Name + verified, "Class of 2010", "💼 Senior Software Engineer & Tech Lead at Tech Avenue Private Limited",
  location, email, phone; outlined "✎ Edit Profile" + ⋯.
- Tabs: Overview · Posts · About · Experience · Education · Mentorship · Activity.
- Overview cards each with "✎ Edit": About Me; Professional Details (2-col label/value: Current Position, Company,
  Industry, Location, Website link; company logo + name on right); Education (school logo, institution, qualification •
  class/years) …
- Right: Profile Completion (90%, purple bar, checklist with green checks: Basic Information, Education, Experience,
  Contact Information, Profile Photo & Cover, Add a Short Bio (empty circle); outlined "Complete Profile"); My Network
  ("486 Connections", avatar row "+481", "Manage Network →"); My Communities ("5 Communities"; thumb, name, members, ›;
  "View All Communities →"); Photos & Memories ("24 Photos", 4 thumbs "+21" — photos from member's posts).
- Sidebar promo: "Complete Your Alumni Profile" + "Update Profile". Top nav includes Jobs tab.

## Find Alumni — `Find Alumni Network Dashboard`
- Breadcrumb My Network › Find Alumni; title + subtitle "Search and connect with SST alumni across batches, locations,
  industries and organizations."; search "Search by name, title, company or keywords…".
- Table-like rows: avatar, name (+ verified), class; designation + company (two lines with icons); location; mutual
  avatars stack + "12 mutual"; purple "Connect" or outlined "Message" (if connected); ⋯. Infinite scroll.
- Right: Total Alumni card (big number, graduation-cap illustration); Filters (dropdowns Batch/Year, Location,
  Industry, Company, Designation, "+ More Filters", purple "Search Alumni"); "Invite & Expand Network" card + outlined
  "Invite Alumni".

## Find Alumni — consolidated (3 variants: `Find Alumni Network Connections`, `SST Alumni Network Dashboard`,
## `SST Alumni Network Directory`)
- One page combining all three: search bar (with attached purple "Search" button), filter dropdown chips row
  (Batch / Year, Location, Industry, Company, More Filters ▾, "Clear All").
- Tabs: All Alumni (2,846) · People You May Know (24) · Same Batch (36) · Same City (118) · Same Industry (72).
- "2,846 alumni found", list / grid toggle, "Sort by: Relevance ▾".
- List view rows as above; Grid view cards: campus cover strip, round photo, name + verified, class, job, city,
  mutual count, purple "Connect" + outlined "View Profile", ⋯.
- Numbered pagination (‹ 1 2 3 4 5 … 143 ›).
- Right: Advanced Search card (text + dropdowns + More Filters + Clear All + "Search Alumni"); Your Network Summary
  (4 tinted tiles: Connections, Mutual, Batches, Groups); Invite & Grow (purple "Invite Alumni" + outlined "Import from
  Contacts" — NEW CSV/vCard import of addresses to invite); Search by Batch (class + count list, "View All Batches →");
  Common Groups (thumb, name, members, Join).

## Settings — shell
- Title "Settings", subtitle "Manage your account, privacy, notifications and security preferences."
- Secondary nav card (white): Account & Privacy, Notifications, Security, Connections, Visibility, Communities,
  Preferences, Language & Region, Data & Privacy, Help & Support (icons; active light purple).
- Sidebar promo varies per section ("Manage Your Account" / "Control Your Visibility" / "Manage Your Connections") with
  outlined "Help & Support".
- NEW member privacy settings (stored per member, enforced on the backend): see sections.

## Settings › Account & Privacy — `SST Alumni Portal Settings Dashboard`
- Account Information card (Edit): Full Name, Email Address, Phone Number, Password •••• "Change".
- Profile Visibility card: rows with dropdown (globe "Visible to All Alumni" / people "My Connections Only"):
  Profile Visibility, Contact Information, Education & Experience, Posts & Activity (info icons).
- Privacy Controls toggles: Allow connection requests from all alumni; Show me in alumni directory and search results;
  Allow others to see my communities; Allow messages from people who are not in my network; Show my online status.
- Right: Account Security (2FA "Enabled" pill + ›; Login Alerts toggle — NEW per-user login alert opt-out; Change
  Password ›); Active Sessions (device icon, "Windows • Karachi, PK", "This device"/"Last active …", "Current session"
  green pill, ⋯; outlined "Sign Out of All Other Sessions"); Account Actions (Download My Data ›, Deactivate Account ›
  (NEW self-deactivation, reversible by signing in again / admin), Delete Account › red).

## Settings › Visibility — `Alumni Portal Visibility Settings Dashboard`
- Profile Visibility: "Who can view my profile" dropdown (All Verified Alumni / My Connections / Only Me); toggles Show
  my profile in alumni directory; Allow my profile to appear in search results.
- Profile Information Visibility rows (icon + dropdown): Education, Experience, Contact Information, Email Address,
  Date of Birth, Location (City). Options: All Verified Alumni / My Connections Only / Only Me.
- Activity & Presence toggles: Show my online status; Show my last active time; Show my activities (posts, likes,
  comments).
- Other Visibility Controls toggles: Allow others to view my connections; Show mutual connections to others; Allow my
  profile in "People You May Know".
- Right: Profile Preview with tabs As Alumni / As Connection / As Public (mini profile card: cover, photo, name,
  class, job, city, "View Full Profile ↗"); Visibility Summary list with coloured pills (All Verified Alumni green,
  My Connections Only blue, Only Me grey, Visible to Others green); Visibility Tips with green checks.

## Settings › Connections — `Alumni Portal Connections Settings Dashboard`
- Connection Requests radio list: Anyone in the alumni community; Alumni from my batch only; Alumni from my batch and
  related batches (±5 years); Only people I send a connection request to.
- Messaging Permissions toggles (icon, title, description): My connections only; Other alumni in the portal; Allow
  messages from community members.
- Network Visibility: Show my connections on my profile; Show mutual connections.
- Connection Preferences: Allow follow requests (let alumni follow you without a connection); Suggest my profile to
  other alumni.
- Right: My Network (Connections, Pending Requests, Sent Requests; "Manage My Network →"); Pending Requests (Accept /
  Decline); Blocked Users ("You have 3 blocked users", avatars, "Manage"); Connection & Network Tips.

## Settings › Notifications — `Alumni Portal Notification Settings`
- Channel tabs (filter / master toggles): In-App · Email · Push · SMS (NEW SMS channel per category).
- Groups with rows (icon, title, description, 4 channel checkboxes In-App / Email / Push / SMS, row master toggle):
  Activity — Messages; Connection Requests; Posts & Mentions; Comments & Reactions.
  Community & Engagement — Community Updates; Event Reminders; Job Opportunities; Mentorship Updates.
  Other — Platform Announcements; News & Publications; Marketing & Updates.
  (Map to backend categories; NEW: mentions, comments/reactions, community updates, news, marketing; SMS channel.)
- Right: Notification Preferences radio (All Updates (Recommended) / Essential Only / Custom — presets);
  Notification Preview (sample notification card); Notification Summary (In-App / Email / Push / SMS enabled/disabled,
  green check / empty circle); outlined "Reset to Default Settings".

## Settings › Security — `Alumni Portal Security Dashboard`
- Two-Factor Authentication card ("Enabled" pill): Authenticator App row ("Active", ⋯); Recovery Codes ("View Codes").
- Password row + "Change Password"; Login Alerts toggle; Security Checkup + "Run Checkup" (NEW checklist dialog).
- Recent Login Activity table: Device / Browser (icon, "Windows • Chrome", OS), Location (city from IP — NEW geo
  lookup, optional), Date & Time, Status pill (Current Session / Successful / Failed), ⋯; "View All Activity →".
- Right: Security Status ring "100%" "Your account is well protected" + checklist (Strong password + updated date,
  Two-Factor Authentication, Login alerts, No suspicious activity + last checked); Trusted Devices (NEW "remember
  this device" skips 2FA for a period; list with "Trusted" pill, ⋯; "Manage Trusted Devices"); Security Tips.

## Settings › Communities — `SST Alumni Communities Settings Dashboard`
- Community Membership & Visibility toggles: Show my community memberships on my profile; Allow other alumni to see
  my community activity; Allow communities to suggest me as a member.
- Community Invitations: "Who can invite me to communities?" dropdown (All Verified Alumni / Connections / No one);
  Automatically accept invitations from communities I follow; Email me when I receive a community invitation.
- Community Participation: Default post visibility in communities (Community Members ▾); Allow members to mention me
  in community posts; Allow community admins to tag me in announcements; Get notified when there is a reply to my post.
- Community Privacy & Content: Show my name and profile when I post in a community; Allow my posts to be shared
  outside the community; "Report inappropriate content and members ›".
- Right: My Communities ("You are a member of 8 communities", thumb, name, members, "Member" pill, ⋯); Community
  Notifications radio (All Community Updates / Important Only (Recommended) / Custom); Community Tips.

## Settings › Preferences — `SST Alumni Portal Preferences Dashboard`
- Feed & Content Preferences: "Show me content from" checkboxes (My Network, My Communities, My Batch, All Alumni);
  "Content types to show" (Posts, Events, Jobs, Resources, Announcements); Feed order dropdown (Most Relevant
  (Recommended) / Latest); toggle Hide content I'm not interested in (NEW "not interested" on posts).
- Content & Interaction toggles: Auto-play videos in feed; Show read receipts in messages (NEW — hide my read
  receipts); Show typing indicator in messages; Enable link previews.
- Display & Theme: Appearance segmented Light / Dark / System (NEW member dark mode); Font size Small / Medium / Large;
  Compact view toggle.
- General Preferences: Open links in a new tab; Show profile suggestions (People You May Know); Receive weekly email
  digest (NEW weekly digest task); "Reset Preferences" button.
- Right: Feed Preview (sample post card); Language & Region quick selects (Language, Timezone, Region); Experience
  Summary (Feed order, Appearance, Font size, Weekly digest pills); Preference Tips.

## Settings › Language & Region — `Language & Region Settings Dashboard`
- Language radio cards with flags: English (English (US)), اردو Urdu, العربية Arabic (from enabled languages).
- Region & Location: Country / Region (flag select), City select.
- Date & Time: Date format dropdown ("DD MMM, YYYY (e.g., 25 Nov, 2026)"), Time format radio 12-hour / 24-hour,
  First day of week, Calendar type (Gregorian (Default)).
- Timezone dropdown "(GMT+05:00) Pakistan Standard Time (PKT)".
- Regional Preferences toggles: Show region-specific events and opportunities; Use local date and time in emails and
  notifications.
- Footer: outlined "↻ Reset to Default" + purple "Save Changes".
- Right: Preview (sample post with formatted date/time/location); Your Settings Summary list; Tips.
  NEW per-member locale settings used to format dates in the UI and emails.

## Settings › Data & Privacy — `Alumni Portal Data & Privacy Dashboard`
- Your Data: checklist of what an export contains + purple tile "Export Your Data" / "Request Data Export".
- Privacy & Consent toggles: Allow use of my data for portal improvements; Allow personalized recommendations;
  Allow communications about new features and updates; Allow occasional alumni and school announcements (NEW consents).
- Data Retention: "Keep my account data for" dropdown "As per portal policy (Recommended)".
- Account Actions: two tiles — Deactivate Account (temporarily disable; reactivate by signing in again — NEW) and
  Delete Account (red border; permanent — existing deletion request).
- Right: Privacy Summary (Data export Available, Analytics Allowed, Personalized recommendations, Product updates,
  Announcements, Data retention As per policy); Recent Data Requests table (Request Type, Requested On, Status pill
  Completed / Pending, ⋯; "View All Requests →" — record exports as requests); Tips.

## Settings › Help & Support — `SST Alumni Portal Help & Support Dashboard`
- 4 tiles: Create a Ticket (active), Browse FAQs, Guides & Tutorials, Contact Us.
- Create Support Ticket form: Category* select, Priority* (flag icon, Low/Medium/High/Urgent), Subject*, Description*,
  Attachments (optional, "Max 10 MB per file", "Upload Files"), buttons Clear / purple "Submit Ticket".
- My Support Requests table: Ticket # (SST-10427), Subject, Category, Status pill (In Progress blue / Resolved green /
  Closed grey), Updated; "View All Requests →". NEW support ticket module with staff handling in admin.
- Right: Quick Help links (Update my profile information, Manage notification settings, Reset my password, Enable
  two-factor authentication, Control my privacy and visibility, Export my data); FAQs accordion + "View All FAQs"
  (NEW admin-managed FAQs); Contact Information (email, phone + hours, address — from General settings).
