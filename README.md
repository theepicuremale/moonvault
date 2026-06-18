# incoming

Throwaway branch. The phone (or admin UI) pushes original photos
here under `photos/<Album Title>/`. A GitHub Actions workflow
processes them onto `main` and force-resets this branch back to
this placeholder so originals never accumulate in any branch's
history.

The workflow file lives here intentionally — GitHub Actions reads
workflow definitions from the branch being pushed, so removing it
would silently disable processing of future uploads.
