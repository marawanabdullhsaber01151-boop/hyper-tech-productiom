<!-- @format -->

# الأوامر

## بعد نسخ الملفات

```
npm run build:web
git add -A && git commit -m "feat: wipe script, arabic audit, lazy fix"
git push
```

بعد الـdeploy اعمل Hard refresh (Ctrl+Shift+R).

## مسح كل العملاء (نهائي — مفيش رجوع)

1. خُد backup أو اعمل Neon branch الأول.
2. جرّب من غير مسح:

```
npm run wipe:customers -- --dry-run
```

3. للمسح الحقيقي:

```
npm run wipe:customers
```

واكتب: امسح العملاء

ملاحظات: مفيش أي أثر في السجل بالتصميم. الكميات المحجوزة راجعها يدوي. phase0_number_sequences ماتلمسش.
