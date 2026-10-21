# UAT walkthrough

A script for a person to follow, in order, with the app open in front of you. You are not
testing the software — you are using it and deciding whether it does what you would expect a
time tracker to do.

Work down the page. Each section says what to do, then what you should see. **The
"What to look for" lines are the script; everything else is you being a person.** Where a
step says *does this match what you would expect?*, the honest answer is often no, and that
is the point of the exercise.

Budget about 90 minutes for sections 1 to 14. Section 15 needs a second device and a Dropbox
account, and is the most important thing here.

**This has never been run.** No one has walked this script before. Anything confusing,
missing or wrong that you hit is a finding, and the sections are written knowing that.

---

## Before you start

You need:

- A browser. Chromium is what the automated tests use; if you have Firefox or Safari, say
  which — that difference is worth knowing and nobody has checked it.
- A **browser profile the app has never seen**. Not a cleared one — a different one, such as
  a second Chrome profile or a private window that stays private. An existing profile with
  history in it hides exactly the first-run problems worth finding.
- A Dropbox account, for section 15 only.
- A rough idea of a real week of your work, so the entries you add feel like something you
  would actually record.

Start at the app's home page and leave it there.

---

## 1. The first screen, with nothing in it

You should see the app's name at the top left with a small clock icon, a status dot on the
right, and a menu button. Below that, a **Timer** card and an **Entries** card.

Top right is this app's Dropbox connection: a cloud with a mark inside it. A tick means
synced, a bang means the last sync failed, a clock means changes are still waiting, and
chasing arrows mean a sync is running. Before a Dropbox app key is added it shows a plus,
and while there is nothing to connect to it shows a slash.

Hover over it to read the state in words — the mark alone is a shape, and the tooltip is what
turns it into an answer. Pressing it does the one thing its state calls for (connect, or
sync now) and never takes you off the page. The detail lives on Settings → **Sync**, behind
the menu, where it is written out in full.

> **What to look for.** Does the colour of the cloud tell you something before you read the
> tooltip? Could you tell "synced" from "still waiting" without hovering? Is there anything
> you expected the header to show that you have to go to Settings for?

The Entries card will say something like *"No entries yet. Start the timer above, or add one by
hand."*

> **What to look for.** Is the empty screen a helpful first impression, or does it look broken?
> Would you know what to do first? Is anything on it a mystery? Does the status dot make sense
> as something you can press, and does pressing it do what its label says?

---

## 2. Set up a client to work for

Go to **Settings** from the menu at the top right.

Press **New client**. Fill in a name — use a real one, like a client you work for. If you have
a rate for them, add it. Press **Add client**.

Your new client is one row in **Clients and projects**. Its projects live underneath it, and
the group starts closed, so the list does not grow every time you add a project. Click the
client's name to open it, and again to fold it away.

Open your client, then press **New project** underneath its projects. Give the project a
colour. Notice the client is already filled in for you — you did not have to pick it.

> **What to look for.** Is it obvious that the projects are there and merely folded up, rather
> than gone? Was the client name obviously the thing to click, without hunting for a caret or
> an arrow? Does it stay obvious which client each project belongs to once opened? Was it
> clear that **New project** adds to *that* client?

> **What to look for.** The colour picker should show you how the colour will read against the
> page before you commit to it. Did each new thing you created get a *different* colour from
> the last one? If everything came out the same blue, that is a finding — write it down.

Set **Currency for work with no client** to your usual currency while you are here.

> **What to look for.** Is it obvious this setting affects only work with no client? Would you
> have found it without reading this sentence?

---

## 3. Start a timer and watch it run

Back on the home page. Your client now has a line on the Timer card with a **Start** button.
Press it.

The button becomes **Stop**, and elapsed time starts counting up in `H:MM:SS`.

Your client's **name** is also a button. Press it and the projects under that client appear
underneath, each with its own play button — so you can start the timer against a specific
project rather than the client's default one. Once a project's timer is running, that project
line carries its own ticking count-up and a square to stop, so you can stop and discard from
there too. Press the name again and they fold away.

> **What to look for.** Does the number ticking up feel trustworthy? Is it clear *which* client
> the timer belongs to? Is it obvious how to stop it? When you pressed the client's name, did
> the projects appear under *that* client and not another? Was it clear that a project's
> **Start** starts the timer for that project?

Leave it running for a minute or two. Do not stop it yet.

---

## 4. Close the tab mid-timer

This is the step most likely to surprise you, so do it deliberately.

With the timer still running, close the tab. Your browser should ask you to confirm leaving.
Confirm it.

Open the app again.

> **What to look for.** The timer should still be running, with the elapsed time carried on and
> counting. It should **not** have stopped and lost the time. Did the browser actually prompt
> you? If it did not, that is a finding.

---

## 5. Stop the timer, and land in the entry form

Press **Stop** on the timer.

The app should take you to a form to finish describing the work — this is deliberate, so you
classify it while it is fresh.

> **What to look for.** Did it take you somewhere, or did it feel like the timer just stopped
> and left you to hunt? Is it obvious what this form is for?

---

## 6. Fill in the entry

The form asks for a **Start** time and then either a **Duration** or an **End** time.

1. Set **Start** to a plausible time this morning.
2. Leave it on **Duration** and type how long you meant to work — try `1:30`.
3. Choose your **Project**.
4. Type a couple of **Tags** — press Enter after each. Try something with an accent in it, like
   `café`, deliberately typed as `cafe` plus a combining accent if your keyboard allows.
5. Add a **Note** in your own words.
6. Tick **Billable** if you have a rate on the project, and look at the money shown.

Press the button to save. You should land back on the home page with the entry in the list.

> **What to look for.** Which field did your eye go to first, and was that the right one? Did
> the duration read back the way you typed it? Did the money look right — is `90` read as an
> hour and a half, or as ninety of something? When you pressed Enter to add a tag, did the tag
> actually attach to the entry, or did it just appear in the box? Try saving with the name
> blank — does it stop you, or let you through?

---

## 7. Read the list and the totals

Your entry should be under a heading with the day's date spelled out, with a subtotal for the
day.

Above the list there is a period selector: **Daily**, **Weekly**, **All**. Try each.

There is also a chevron button that collapses the Entries card.

> **What to look for.** Do the numbers add up to what you expect, in the units you think in?
> Does switching to Weekly change the grouping in a way that makes sense? When you collapse
> the card, do you still keep the totals you wanted to glance at?

---

## 8. Filter by client

Press your client's **name** on the Timer card — not Start, the name.

The entries below should narrow to that client. Press it again to clear.

> **What to look for.** Is it obvious the list just filtered, or did it look like the other
> entries vanished? Is it clear how to undo the filter? Would you have tried pressing the name
> if nobody had shown you?

---

## 9. Edit what you recorded

Press **Edit** on your entry. Change the note and save.

The form should open on the **end time**, not on a duration — an entry you have
already recorded already knows when it ended, so that is the thing you are most
likely to want to change. Switch to **Enter a duration** if you would rather.

The **Save changes**, **Cancel** and **Delete** buttons are at the *top* of the card,
not the bottom.

> **What to look for.** Did your cursor go where you needed it without you having to hunt?
> After saving, did the change show straight away, or did you have to reload? Were the
> buttons where you expected them, or did you have to scroll to find them?

---

## 10. Delete an entry — and undo it

Press **Delete** on an entry. You should get a confirmation that tells you what will happen.
Confirm it.

An undo bar should appear along the bottom for a few seconds. Press **Undo**.

Do it again, but this time let the bar time out.

> **What to look for.** Did the confirmation tell you anything you did not already know — in
> particular, that the entries are kept and only the link is removed? Was the undo bar long
> enough to be usable without reading it first? Once it went, was deleting again easy?

---

## 11. Archive a project - and check your entries survive

Go to **Settings -> Clients and projects**, click your client's name to open its projects,
and press **Archive** on your project.

Notice what did *not* happen: no confirmation, no count of affected entries, no second
confirmation about billable time. Archiving moves nothing, so there is nothing to warn about.

Now look at your entries on the home page.

> **What to look for.** This is the most important check in this section. Your entries should
> still be there and should still name your project, marked as archived. If they went
> uncategorised, or disappeared, that is a serious finding - stop and write it down.

Now archive the **client** too. Check that its projects were *not* archived along with it —
they should have left the list, and should still be there, unrestored, under **Show archived
clients and projects**.

> **What to look for.** Archiving a client must not archive its projects: a client can be
> finished with while work under it continues, so the projects must still exist. Ticking
> **Show archived clients and projects** should bring the client *and* its projects back
> together. If the projects came back already archived, that is a finding - write it down.

---

## 12. Check that archived things are gone from everywhere you choose

With a project and a client archived, look for them in the places you would normally pick
one:

- the **client list on the Timer card**
- the **project dropdown on a new entry**
- the **client filter** above the entries

They should not be offered anywhere.

> **What to look for.** Anything still offering an archived project or client is the whole
> failure this change is meant to prevent - work filed under a client you thought you had
> closed off. Check the new-entry form carefully.

Then find them again: **Settings** has a single **Show archived clients and projects**
checkbox. Tick it. Archived projects appear inside their client's group, so open the group to
reach **Restore**.

> **What to look for.** One checkbox should bring back both archived clients and archived
> projects, and unticking it should hide both again. If it only does one, write it down. Can
> you still edit an archived thing? Is there a **Restore** that brings it back, and does it?

One more thing worth trying: archive a client that has a project, then edit an entry that is
filed under that project and save it.

> **What to look for.** The project must still be selected, and the client must still be named
> as its group. If the entry came back uncategorised, the app silently re-filed work you had
> already recorded - which is worse than showing nothing.

---

## 13. Appearance

Go to **Settings → Appearance**. Switch between light, dark and system.

> **What to look for.** Reload the page. Is there any flash of the wrong theme before the app
> settles? Switch your whole operating system to dark mode while the app is set to System —
> does it follow? If you are on Firefox or Safari, does the theme apply at all?

---

## 14. Back up your work, and put it back somewhere else

Two parts, and the second one is the point.

**Part one — download.** In Settings, find the **Backup** panel and press **Download backup**.
A file downloads.

**Part two — restore into a device that has nothing.** Open a **second, private window** of
the app — this is a separate profile with an empty database. Go to Settings → Backup, press
**Restore from file**, and choose the file you just downloaded.

> **What to look for.** Your entries should appear in the empty window. Confirm that restoring
> did **not** wipe anything — on this empty device there was nothing to wipe, so to test it
> properly, first add one entry by hand in that second window, *then* restore, and check your
> hand-made entry is still there alongside the restored ones. Restoring is meant to **add**,
> not replace. If your hand-made entry disappeared, that is a serious finding.

Then close that private window. Nothing should have leaked into your normal profile.

---

## 15. Two devices, one account

The most important section, and the one that has never been done by anyone.

You need a second device or a second browser profile that has never seen the app, both signed
into the same Dropbox account.

1. In both, open Settings → **Sync**, and connect a Dropbox account. You will be sent to
   Dropbox's consent screen and back. Each device signs in separately.
2. Wait for the header to show **Synced** in both.
3. On device A, record an entry.
4. On device B, wait a few seconds. The entry should arrive by itself, with no button pressed.
5. Now make **both** devices create an entry while **both are offline** — turn off the network
   on both (airplane mode is easiest). Record an entry on A. Record a different entry on B.
   Turn the network back on in both.
6. Wait. Both devices should end up with **both** entries.
7. On device A, delete one of the entries. On device B, wait. **The deleted entry must stay
   deleted** — it must not come back.
8. On device A, start a timer, then switch the network off mid-sync. Turn it back on and
   reload the app. Everything you had should still be there.

> **What to look for.** Step 6 is the whole product: work recorded offline on two devices,
> both surviving, neither lost. Step 7 is the most plausible way this app could quietly lose
> your data. If anything at all goes wrong here, that is the finding that matters most — please
> write it up in detail, including what you clicked and what you expected.

If step 1 will not connect at all, that is also a finding, and a useful one: write down the
exact message you got.

---

## 16. Losing the network

On one device only, turn the network off. Use the app normally: record an entry, edit one,
delete one. Then turn the network back on and reload.

> **What to look for.** The app should keep working with no connection at all — it is local
> first. Nothing should be lost or blocked. When the network returns, the header should
> eventually show **Synced** without you doing anything.

---

## 17. Expected hours — set a budget and see it compared

Go to **Settings -> Expected hours**. Each client has a row. Press **Set hours** on
one of them.

Enter the hours you expect to spend on that client in a week, and tick the days you
expect to work. Press **Save expected hours**.

Now open **Reports** from the menu at the top right. You should see a table: the
client, the hours expected, the hours actually tracked, the difference, and a
utilisation figure.

> **What to look for.** A client with no expected hours should show a **dash** (`—`)
> rather than `0%` — a dash means "not known" and a zero means "none expected", and
> they are different answers. The expected hours should be a whole number of hours per
> week, not a per-day average.

Try an uneven week. Set the hours to 37.5 and untick Friday — the form should say
the week does not divide evenly and ask you for the hours for each day instead of
quietly rounding.

> **What to look for.** It should refuse rather than round. If it accepts 37.5 hours
> over four days by picking 9.375 hours a day, that is a finding: the days would no
> longer add up to the week.

**Leave alone.** The app does not have a way to record leave as leave, so if you take
a day off, the time you did not work simply shows as time you did not work. There is
no way to excuse it from a client's expected hours. That is a known limitation, not a
bug to report — but it is worth knowing about before you rely on the numbers.

---

## 18. Editing a running timer

Start a timer. The button beside it should be a **pencil**, not a bin, and it should
open the running entry's own form.

Change the note, save, and check the timer is still running.

> **What to look for.** The pencil should open the entry that is running — the one
> whose time is counting up — and not a blank form. If you cannot get rid of a running
> timer that you want to abandon, the **Delete** button in that form is where it is
> now; that is a change from before, and worth saying out loud if it surprises you.

---

## 19. Two devices, one account — the new part

With the app connected to Dropbox on both devices, and the polling rate left at ten
seconds, record something on device A. Within a few seconds it should appear on
device B **without** you doing anything.

Then record something on device B and look at device A.

If it does not appear on its own, check **Settings -> Sync -> Check for other devices**
and make sure it is not set to **Off**. Turning it off does not stop the app syncing
when you open it, when you change something, or when you come back to the tab — it
only stops the automatic check.

> **What to look for.** How long did it take? Was there anything on screen that
> explained the wait, or did it look like nothing was happening? If you left a tab
> open and idle for a while, did it keep working, or did it stop?

---

## 20. The charts, and the table behind them

On the **Reports** screen, scroll past the tables to the charts.

Press **Show table** on a chart. It should swap to a table with the same figures.

Then press **Show chart** to go back.

> **What to look for.** Does the table show the same numbers as the chart? Is the
> button easy to find and obvious about what it will do? If you use only the keyboard:
> can you reach the button, and can you reach the bars themselves — and does
> focusing a bar tell you what it is?

> **A note on what the charts are for.** A chart is a picture of the data, not the
> data itself. The table is the data, and it is the one a screen reader reads. If a
> chart and its table ever disagree, that is a serious finding — please write it down.

---

## 21. An invoice

On the **Reports** screen, under **Invoice**, choose a client and press **Show the
invoice**.

The lines should be your billable work, grouped by project, with the rate charged
and the amount.

> **What to look for.** Do the line amounts add up to the total exactly? Is the rate
> on each line the rate you actually charged — including an entry where you set your
> own rate rather than using the project's? Is a non-billable entry left out, and an
> entry with no rate at all?

If you change a rate and come back, the invoice changes with it. That is on
purpose — nothing about an invoice is stored — but it is worth knowing before you
rely on an old figure.

---

## What we want from you

For each section, one of:

- **"That worked and I expected it to."**
- **"That worked but I did not expect it to"** — and what you expected instead. These are the
  most valuable answers in the document. An app that is correct but surprising is still a
  problem, and nobody can see it except the person holding it.
- **"That did not work"** — what you did, what you expected, what happened instead.
- **"I could not tell whether it worked"** — also worth reporting. If you cannot tell whether
  your work was saved, that is itself the finding.

Please note **anything that made you hesitate**, even if you worked it out. Hesitation is
data.

Do not skip a section because it looks irrelevant. Section 11 and section 14 are the two where
a plausible-looking app can quietly lose your work, and both take two minutes.
