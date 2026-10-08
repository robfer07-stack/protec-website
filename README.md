# ProTec Dental Laboratory — website (static mockup)

A clean, responsive, multi-page website for **ProTec Dental Laboratory** (proteclab.com.au), a Melbourne dental lab specialising in **AOX / All-on-X full-arch implant restorations**.

It's plain **HTML + CSS + a little vanilla JavaScript**. There's no build step, no framework and nothing to install, so the files upload straight into HostGator's `public_html`.

---

## What's in the project

```
protec-website/
├── index.html          Home: hero, AOX focus, services, technology, clinician workflow, gallery, CTA
├── services.html       AOX, photogrammetry, case planning, implant, zirconia C&B, digital workflow, FAQ
├── technology.html     Zirkonzahn / Roland / Aidite milling, PIC & iMetric photogrammetry, materials
├── about.html          Story, values, team (placeholders), 3 locations
├── contact.html        Send a Case form (markup only) + contact details
├── 404.html            "Page not found" page
├── v2/                 Version 2 — same pages, editorial layout (see Design versions)
├── v3/                 Version 3 — same pages, engineering layout
├── assets/
│   ├── css/styles.css  ALL styling. Brand colours & fonts are at the top (":root")
│   ├── js/main.js      Mobile menu, header shadow, scroll reveal, form notice
│   ├── js/review.js    Preview-only review/feedback tool (see section 6)
│   └── img/            Logo, favicons, social image, illustration, gallery/ for case photos
├── favicon.ico
├── robots.txt, sitemap.xml, site.webmanifest   SEO / browser files
├── htaccess.example    HTTPS redirect, caching, old-URL redirects (rename to .htaccess at go-live)
├── .gitignore, .editorconfig
└── README.md           This file (not needed on the server)
```

The **header and footer are repeated in every page** (that's how plain static sites work). If you change the menu, phone number or footer, update all 6 HTML files. In Cursor, use **Find in Files** (Ctrl/Cmd + Shift + F) and replace them all at once.

## Design versions

Three visual directions of the same site sit side by side so one can be chosen:

| | Where | Direction |
|---|---|---|
| **Version 1** | repo root (`index.html`, `services.html`, …) | The current site |
| **Version 2** | `/v2/` | Light, airy clinical-editorial layout |
| **Version 3** | `/v3/` | High-contrast, precision-engineering layout |

Every page has **V1 V2 V3** in the black bar at the top left. The highlighted one is the version you’re on; the others open the same page in that version (or that version’s home if the page doesn’t exist).

V2 and V3 reuse the shared images and scripts in `assets/`. Each has its own stylesheet (`v2/assets/css/styles.css`, `v3/assets/css/styles.css`). Copy, business details and orange placeholders match Version 1.

Once a version is chosen, delete the other two folders (and the version switcher in the top bar) and keep the winner at the site root. No build step — the files still upload as they are.

---

## 1. Preview it locally

Any one of these works:

- **Easiest:** double-click `index.html` to open it in your browser.
- **In Cursor:** install the **"Live Server"** extension, then right-click `index.html` → *Open with Live Server*. The page reloads every time you save.
- **Terminal:** run `python3 -m http.server 8000` in this folder, then open http://localhost:8000

## 2. Edit in Cursor

1. In Cursor, go to **File → Open Folder…** and pick the `protec-website` folder.
2. Common edits:
   - **Text:** edit the `.html` files directly. Each section is labelled with a comment like `<!-- ===== Services overview ===== -->`.
   - **Colours / fonts / spacing:** change the variables at the top of `assets/css/styles.css` (`--brand`, `--ink`, and so on).
   - **Logo:** replace `assets/img/logo.webp` (header) and `assets/img/logo-light.png` (footer, for the dark background). Keep the same file names, or update the `<img>` tags.
   - **Photos:** put case photos in `assets/img/gallery/`, then swap each placeholder `<figure>` in `index.html` for the `<img>` line shown in the comment above it.
3. Ask Cursor's AI for help, for example: *"Add a Digital Dentures section to services.html that matches the existing service blocks."*

## 3. Put it on GitHub

A local git repo with an initial commit is already set up. To publish it:

```bash
# 1. Create an empty repo on github.com (e.g. "protec-website"). Don't add a README.
# 2. In this folder:
git remote add origin https://github.com/<your-username>/protec-website.git
git branch -M main
git push -u origin main
```

After that, the routine is: edit, then `git add -A`, then `git commit -m "Describe the change"`, then `git push`. You can also do this from Cursor's Source Control panel.

## 4. Upload to HostGator

> ⚠️ **Your domain currently runs a WordPress site in `public_html`.** Uploading these files on top of it will mix the two sites. Choose one of these:
> - **Test first (recommended):** upload into a subfolder, e.g. `public_html/new/`, and preview it at `https://proteclab.com.au/new/`. (In that case, set `SITE_ROOT = "/new/"` in the small script at the top of `404.html`.)
> - **Go live:** back up WordPress first (cPanel → *Backup*, or download `public_html` plus the database). Then remove or move the WordPress files out of `public_html` and upload this site.

**Option A: cPanel File Manager (no extra software)**
1. Zip the *contents* of this folder (not the folder itself). Leave out `.git`, `README.md` and the `.zip`.
2. Log in to HostGator → **cPanel → File Manager → public_html** (or your test subfolder).
3. Click **Upload**, choose the zip, then right-click it → **Extract**. Delete the zip afterwards.
4. Make sure `index.html` sits directly inside `public_html`, not inside a nested folder.

**Option B: FTP (FileZilla)**
1. cPanel → **FTP Accounts** to get or create the login. The host is usually `ftp.proteclab.com.au`, port 21.
2. Connect with FileZilla and drag the files into `public_html`.

**At go-live:**
- In cPanel, check **SSL/TLS Status** to confirm the free SSL certificate is active.
- Rename `htaccess.example` to `.htaccess` in `public_html`. This forces HTTPS, enables caching and redirects the old WordPress URLs (`/about-2/` and so on). Enable "Show hidden files" in File Manager to see it.
- Submit `https://proteclab.com.au/sitemap.xml` in Google Search Console.

## 5. Make the Send a Case form work

The form on `contact.html` is **markup only** (`action="#"`). Until it's connected, submitting shows a "Mockup only — please call or email" message. Pick one option:

- **Formspree (simplest):** sign up at formspree.io and create a form. Then change the form tag to
  `<form action="https://formspree.io/f/YOUR_ID" method="post" enctype="multipart/form-data" data-protec-form>`.
  Submissions are emailed to you. *File uploads need a paid Formspree plan.*
- **PHP mail on HostGator:** create `send-case.php` to validate the fields and email them to info@proteclab.com.au, and set `action="send-case.php"`. Add spam protection (a honeypot field or reCAPTCHA). Cursor can write this file for you.
- **Large scan files:** STL/PLY files and photogrammetry data can be big. Many labs accept them through scanner portals (3Shape Communicate, Medit Link, iTero, etc.) or a file-transfer link. List the options you accept on the page.

Don't collect full patient names. The form asks for a patient reference instead.

## 6. Review mode (preview feedback tool)

The GitHub Pages preview has a built-in feedback tool (`assets/js/review.js`):

1. Open the preview and press the orange **Review** button (bottom-right).
2. Hover or tap the part of the page you want changed (keyboard: Tab / arrow keys, then Enter; **Esc** cancels). Links and buttons don't fire while you're picking.
3. Write *What should change?*, optionally choose **Nice to have / Important / Must fix**, and press **Add comment**. Each comment gets a numbered pin on the page. Add as many as you like, across several pages. They're saved in your browser, so a refresh won't lose them.
4. Press **Comments → Send to ProTec Website bot**. GitHub opens with a new issue already filled in (label `site-feedback`, page, element, CSS selector, screen size, priority, time). Press **Submit new issue**, then clear the sent comments.

Long batches are split into several issues automatically. If one comment is too long for a link, the text is copied to your clipboard so you can paste it into the issue.

**When it shows:** only on `*.github.io`, or on any address with `?review=1` (remembered in that browser). `?review=0` hides it again. On the real domain it stays hidden unless you add `?review=1`. At go-live you can also delete `assets/js/review.js` and its `<script>` line from each page.

---

## Placeholders to replace

Everything that still needs real content is marked in **striped orange `[square brackets]`**. Search the code for `placeholder` or `[` to find each one.

| Where | What to add |
|---|---|
| Footer (all pages) | ABN |
| Home → testimonial | A real, approved clinician quote and name. The current one is labelled *Example testimonial*. |
| Home → gallery | 6 case photos (with patient consent) |
| Home / Services → AOX | Confirm: try-in / prototype stage, immediate provisionals, zirconia/titanium options |
| Services | Component policy, C&B materials, shade process, scanner portals, turnaround times, courier/pickup |
| Technology | Machine models and photos for Zirkonzahn, Roland and Aidite; CAD software; materials list |
| About | Founding year or story, team names, roles and photos, real team photo (the current one is an AI image taken from the existing site) |
| Contact | Response time, scanner portals, courier instructions, form handler |

**Real details already used** (taken from the current proteclab.com.au): phone 03 9886 5414, info@proteclab.com.au, hours Mon–Fri 8am–5pm, 265 Burwood Highway and 19 Royton Street, Burwood East VIC 3151, and 6 O'Neills Road, Melton VIC 3337, Instagram @protec_dental_lab, plus the AOX, photogrammetry (PIC & iMetric) and case planning service descriptions. Please double-check them.

## Notes

- Fonts load from Google Fonts (Inter and Manrope). To use system fonts only, delete the 3 font lines in each page's `<head>`.
- Brand names (Zirkonzahn, Roland, Aidite, PIC, iMetric) appear as text. Only add their logos if you have permission.
- Accessibility: the pages include a skip link, semantic landmarks, visible focus styles, labelled form fields and reduced-motion support. Keep `alt` text on any new images.
