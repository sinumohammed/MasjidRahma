# Member photos

Drop a photo per member here, named after their unique ID with all
non-alphanumeric characters removed (the `#` in `MR#001` breaks static
asset URL lookups even when percent-encoded, so it's stripped), e.g.:

```
MR001.png
MR002.jpg
```

PNG is tried first, then JPG. If neither exists, the dashboard falls back to a generic home icon.
