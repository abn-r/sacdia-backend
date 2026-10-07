# Public PDF compatibility fixtures

Unmodified QPDF fixtures at revision `4eba95899886e851cc41d76886483b347612f2a8`. These contain synthetic public test documents, not certificates or user data. Tests run offline; QPDF is not installed or required.

Copyright (c) 2005–2021 Jay Berkenbilt, 2022–2026 Jay Berkenbilt and Manfred Holger. Apache License 2.0; see `LICENSE.qpdf.txt`.

- `qpdf-minimal-linearized.pdf` — [QPDF source](https://github.com/qpdf/qpdf/blob/4eba95899886e851cc41d76886483b347612f2a8/qpdf/qtest/qpdf/minimal-linearized.pdf), SHA256 `75b49e60adac5dd53c07e01c20f488e86c81a12f402c3b1d5b2a5d3e1a7ca883`.
- `qpdf-stream-linearized.pdf` — [QPDF source](https://github.com/qpdf/qpdf/blob/4eba95899886e851cc41d76886483b347612f2a8/qpdf/qtest/qpdf/c-linearized.pdf), SHA256 `135cee6bd018c06d40c8c46c4a0230b2799adb90f502e214a347b3855039a24e`.

The first fixture is a one-page linearized PDF using traditional xref tables with a forward `/Prev`. The second uses xref streams and has 30 pages: parsing must produce the deliberate five-page-limit error, not classify a valid linearized format as invalid.

- `qpdf-hybrid-xref.pdf` — [QPDF source](https://github.com/qpdf/qpdf/blob/4eba95899886e851cc41d76886483b347612f2a8/qpdf/qtest/qpdf/hybrid-xref.pdf), SHA256 `df1ae8b9cb2378aaeda6fdc11146dd37328737fd050941390d2c6bd188eea0e4`; genuine hybrid xref compatibility fixture.
