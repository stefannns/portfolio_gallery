/* Font redistribution notices, preserved in the editable source.
Font license notice: fonts
Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.

*/
document.documentElement.lang = "it";
// Editable Batch 2 game. Rebuild using the platform app/h5_build/build.js.
const PACKAGE_CONFIG_FALLBACK = {
  "config_version": "2.0",
  "playable": {
    "runtime_target": "h5",
    "h5_playstyle_type": "general_game",
    "content_locale": "it",
    "min_capability_level": 1,
    "full_capability_level": 1
  },
  "tweaks": [{
    "id": "sequenceCount",
    "kind": "number",
    "label": "sequenceCount",
    "value": 4,
    "default": 4,
    "min": 1,
    "max": 4,
    "step": 1
  }, {
    "id": "moveSec",
    "kind": "number",
    "label": "moveSec",
    "value": 0.35,
    "default": 0.35,
    "min": 0.1,
    "max": 1,
    "step": 0.05
  }],
  "texts": [{
    "id": "GUIDE",
    "label": "Opening guide",
    "value": "Trascina per spazzolare",
    "max_length": 64
  }],
  "images": [{
    "id": "PHOTO_BASE",
    "label": "Base portrait",
    "path": "./assets/photo_base.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_SMILE",
    "label": "Broad smile",
    "path": "./assets/photo_smile.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_SAD",
    "label": "Sad expression",
    "path": "./assets/photo_sad.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_PUCKER",
    "label": "Puckered lips",
    "path": "./assets/photo_pucker.webp",
    "replaceable": true
  }, {
    "id": "PHOTO_GLAM",
    "label": "Final makeup look",
    "path": "./assets/photo_glam.webp",
    "replaceable": true
  }, {
    "id": "TOOL_1",
    "label": "Toothbrush",
    "path": "./assets/tool_1.webp",
    "replaceable": true
  }, {
    "id": "TOOL_2",
    "label": "Toy hammer",
    "path": "./assets/tool_2.webp",
    "replaceable": true
  }, {
    "id": "TOOL_3",
    "label": "Tissue",
    "path": "./assets/tool_3.webp",
    "replaceable": true
  }, {
    "id": "TOOL_4",
    "label": "Makeup brush",
    "path": "./assets/tool_4.webp",
    "replaceable": true
  }, {
    "id": "FX_0_00",
    "label": "FX_0 frame 0",
    "path": "./assets/fx_0_00.webp",
    "replaceable": false
  }, {
    "id": "FX_0_01",
    "label": "FX_0 frame 1",
    "path": "./assets/fx_0_01.webp",
    "replaceable": false
  }, {
    "id": "FX_0_02",
    "label": "FX_0 frame 2",
    "path": "./assets/fx_0_02.webp",
    "replaceable": false
  }, {
    "id": "FX_0_03",
    "label": "FX_0 frame 3",
    "path": "./assets/fx_0_03.webp",
    "replaceable": false
  }, {
    "id": "FX_0_04",
    "label": "FX_0 frame 4",
    "path": "./assets/fx_0_04.webp",
    "replaceable": false
  }, {
    "id": "FX_0_05",
    "label": "FX_0 frame 5",
    "path": "./assets/fx_0_05.webp",
    "replaceable": false
  }, {
    "id": "FX_0_06",
    "label": "FX_0 frame 6",
    "path": "./assets/fx_0_06.webp",
    "replaceable": false
  }, {
    "id": "FX_0_07",
    "label": "FX_0 frame 7",
    "path": "./assets/fx_0_07.webp",
    "replaceable": false
  }, {
    "id": "FX_0_08",
    "label": "FX_0 frame 8",
    "path": "./assets/fx_0_08.webp",
    "replaceable": false
  }, {
    "id": "FX_0_09",
    "label": "FX_0 frame 9",
    "path": "./assets/fx_0_09.webp",
    "replaceable": false
  }, {
    "id": "FX_0_10",
    "label": "FX_0 frame 10",
    "path": "./assets/fx_0_10.webp",
    "replaceable": false
  }, {
    "id": "FX_0_11",
    "label": "FX_0 frame 11",
    "path": "./assets/fx_0_11.webp",
    "replaceable": false
  }, {
    "id": "FX_0_12",
    "label": "FX_0 frame 12",
    "path": "./assets/fx_0_12.webp",
    "replaceable": false
  }, {
    "id": "FX_0_13",
    "label": "FX_0 frame 13",
    "path": "./assets/fx_0_13.webp",
    "replaceable": false
  }, {
    "id": "FX_0_14",
    "label": "FX_0 frame 14",
    "path": "./assets/fx_0_14.webp",
    "replaceable": false
  }, {
    "id": "FX_0_15",
    "label": "FX_0 frame 15",
    "path": "./assets/fx_0_15.webp",
    "replaceable": false
  }, {
    "id": "FX_0_16",
    "label": "FX_0 frame 16",
    "path": "./assets/fx_0_16.webp",
    "replaceable": false
  }, {
    "id": "FX_0_17",
    "label": "FX_0 frame 17",
    "path": "./assets/fx_0_17.webp",
    "replaceable": false
  }, {
    "id": "FX_0_18",
    "label": "FX_0 frame 18",
    "path": "./assets/fx_0_18.webp",
    "replaceable": false
  }, {
    "id": "FX_0_19",
    "label": "FX_0 frame 19",
    "path": "./assets/fx_0_19.webp",
    "replaceable": false
  }, {
    "id": "FX_0_20",
    "label": "FX_0 frame 20",
    "path": "./assets/fx_0_20.webp",
    "replaceable": false
  }, {
    "id": "FX_0_21",
    "label": "FX_0 frame 21",
    "path": "./assets/fx_0_21.webp",
    "replaceable": false
  }, {
    "id": "FX_0_22",
    "label": "FX_0 frame 22",
    "path": "./assets/fx_0_22.webp",
    "replaceable": false
  }, {
    "id": "FX_0_23",
    "label": "FX_0 frame 23",
    "path": "./assets/fx_0_23.webp",
    "replaceable": false
  }, {
    "id": "FX_0_24",
    "label": "FX_0 frame 24",
    "path": "./assets/fx_0_24.webp",
    "replaceable": false
  }, {
    "id": "FX_0_25",
    "label": "FX_0 frame 25",
    "path": "./assets/fx_0_25.webp",
    "replaceable": false
  }, {
    "id": "FX_0_26",
    "label": "FX_0 frame 26",
    "path": "./assets/fx_0_26.webp",
    "replaceable": false
  }, {
    "id": "FX_0_27",
    "label": "FX_0 frame 27",
    "path": "./assets/fx_0_27.webp",
    "replaceable": false
  }, {
    "id": "FX_0_28",
    "label": "FX_0 frame 28",
    "path": "./assets/fx_0_28.webp",
    "replaceable": false
  }, {
    "id": "FX_0_29",
    "label": "FX_0 frame 29",
    "path": "./assets/fx_0_29.webp",
    "replaceable": false
  }, {
    "id": "FX_0_30",
    "label": "FX_0 frame 30",
    "path": "./assets/fx_0_30.webp",
    "replaceable": false
  }, {
    "id": "FX_0_31",
    "label": "FX_0 frame 31",
    "path": "./assets/fx_0_31.webp",
    "replaceable": false
  }, {
    "id": "FX_0_32",
    "label": "FX_0 frame 32",
    "path": "./assets/fx_0_32.webp",
    "replaceable": false
  }, {
    "id": "FX_0_33",
    "label": "FX_0 frame 33",
    "path": "./assets/fx_0_33.webp",
    "replaceable": false
  }, {
    "id": "FX_0_34",
    "label": "FX_0 frame 34",
    "path": "./assets/fx_0_34.webp",
    "replaceable": false
  }, {
    "id": "FX_0_35",
    "label": "FX_0 frame 35",
    "path": "./assets/fx_0_35.webp",
    "replaceable": false
  }, {
    "id": "FX_0_36",
    "label": "FX_0 frame 36",
    "path": "./assets/fx_0_36.webp",
    "replaceable": false
  }, {
    "id": "FX_0_37",
    "label": "FX_0 frame 37",
    "path": "./assets/fx_0_37.webp",
    "replaceable": false
  }, {
    "id": "FX_0_38",
    "label": "FX_0 frame 38",
    "path": "./assets/fx_0_38.webp",
    "replaceable": false
  }, {
    "id": "FX_0_39",
    "label": "FX_0 frame 39",
    "path": "./assets/fx_0_39.webp",
    "replaceable": false
  }, {
    "id": "FX_0_40",
    "label": "FX_0 frame 40",
    "path": "./assets/fx_0_40.webp",
    "replaceable": false
  }, {
    "id": "FX_0_41",
    "label": "FX_0 frame 41",
    "path": "./assets/fx_0_41.webp",
    "replaceable": false
  }, {
    "id": "FX_0_42",
    "label": "FX_0 frame 42",
    "path": "./assets/fx_0_42.webp",
    "replaceable": false
  }, {
    "id": "FX_0_43",
    "label": "FX_0 frame 43",
    "path": "./assets/fx_0_43.webp",
    "replaceable": false
  }, {
    "id": "FX_0_44",
    "label": "FX_0 frame 44",
    "path": "./assets/fx_0_44.webp",
    "replaceable": false
  }, {
    "id": "FX_0_45",
    "label": "FX_0 frame 45",
    "path": "./assets/fx_0_45.webp",
    "replaceable": false
  }, {
    "id": "FX_0_46",
    "label": "FX_0 frame 46",
    "path": "./assets/fx_0_46.webp",
    "replaceable": false
  }, {
    "id": "FX_0_47",
    "label": "FX_0 frame 47",
    "path": "./assets/fx_0_47.webp",
    "replaceable": false
  }, {
    "id": "FX_0_48",
    "label": "FX_0 frame 48",
    "path": "./assets/fx_0_48.webp",
    "replaceable": false
  }, {
    "id": "FX_0_49",
    "label": "FX_0 frame 49",
    "path": "./assets/fx_0_49.webp",
    "replaceable": false
  }, {
    "id": "FX_0_50",
    "label": "FX_0 frame 50",
    "path": "./assets/fx_0_50.webp",
    "replaceable": false
  }, {
    "id": "FX_0_51",
    "label": "FX_0 frame 51",
    "path": "./assets/fx_0_51.webp",
    "replaceable": false
  }, {
    "id": "FX_1_00",
    "label": "FX_1 frame 0",
    "path": "./assets/fx_1_00.webp",
    "replaceable": false
  }, {
    "id": "FX_1_01",
    "label": "FX_1 frame 1",
    "path": "./assets/fx_1_01.webp",
    "replaceable": false
  }, {
    "id": "FX_1_02",
    "label": "FX_1 frame 2",
    "path": "./assets/fx_1_02.webp",
    "replaceable": false
  }, {
    "id": "FX_1_03",
    "label": "FX_1 frame 3",
    "path": "./assets/fx_1_03.webp",
    "replaceable": false
  }, {
    "id": "FX_1_04",
    "label": "FX_1 frame 4",
    "path": "./assets/fx_1_04.webp",
    "replaceable": false
  }, {
    "id": "FX_1_05",
    "label": "FX_1 frame 5",
    "path": "./assets/fx_1_05.webp",
    "replaceable": false
  }, {
    "id": "FX_1_06",
    "label": "FX_1 frame 6",
    "path": "./assets/fx_1_06.webp",
    "replaceable": false
  }, {
    "id": "FX_1_07",
    "label": "FX_1 frame 7",
    "path": "./assets/fx_1_07.webp",
    "replaceable": false
  }, {
    "id": "FX_1_08",
    "label": "FX_1 frame 8",
    "path": "./assets/fx_1_08.webp",
    "replaceable": false
  }, {
    "id": "FX_1_09",
    "label": "FX_1 frame 9",
    "path": "./assets/fx_1_09.webp",
    "replaceable": false
  }, {
    "id": "FX_1_10",
    "label": "FX_1 frame 10",
    "path": "./assets/fx_1_10.webp",
    "replaceable": false
  }, {
    "id": "FX_1_11",
    "label": "FX_1 frame 11",
    "path": "./assets/fx_1_11.webp",
    "replaceable": false
  }, {
    "id": "FX_1_12",
    "label": "FX_1 frame 12",
    "path": "./assets/fx_1_12.webp",
    "replaceable": false
  }, {
    "id": "FX_1_13",
    "label": "FX_1 frame 13",
    "path": "./assets/fx_1_13.webp",
    "replaceable": false
  }, {
    "id": "FX_1_14",
    "label": "FX_1 frame 14",
    "path": "./assets/fx_1_14.webp",
    "replaceable": false
  }, {
    "id": "FX_1_15",
    "label": "FX_1 frame 15",
    "path": "./assets/fx_1_15.webp",
    "replaceable": false
  }, {
    "id": "FX_1_16",
    "label": "FX_1 frame 16",
    "path": "./assets/fx_1_16.webp",
    "replaceable": false
  }, {
    "id": "FX_1_17",
    "label": "FX_1 frame 17",
    "path": "./assets/fx_1_17.webp",
    "replaceable": false
  }, {
    "id": "FX_1_18",
    "label": "FX_1 frame 18",
    "path": "./assets/fx_1_18.webp",
    "replaceable": false
  }, {
    "id": "FX_1_19",
    "label": "FX_1 frame 19",
    "path": "./assets/fx_1_19.webp",
    "replaceable": false
  }, {
    "id": "FX_1_20",
    "label": "FX_1 frame 20",
    "path": "./assets/fx_1_20.webp",
    "replaceable": false
  }, {
    "id": "FX_1_21",
    "label": "FX_1 frame 21",
    "path": "./assets/fx_1_21.webp",
    "replaceable": false
  }, {
    "id": "FX_1_22",
    "label": "FX_1 frame 22",
    "path": "./assets/fx_1_22.webp",
    "replaceable": false
  }, {
    "id": "FX_1_23",
    "label": "FX_1 frame 23",
    "path": "./assets/fx_1_23.webp",
    "replaceable": false
  }, {
    "id": "FX_1_24",
    "label": "FX_1 frame 24",
    "path": "./assets/fx_1_24.webp",
    "replaceable": false
  }, {
    "id": "FX_1_25",
    "label": "FX_1 frame 25",
    "path": "./assets/fx_1_25.webp",
    "replaceable": false
  }, {
    "id": "FX_1_26",
    "label": "FX_1 frame 26",
    "path": "./assets/fx_1_26.webp",
    "replaceable": false
  }, {
    "id": "FX_1_27",
    "label": "FX_1 frame 27",
    "path": "./assets/fx_1_27.webp",
    "replaceable": false
  }, {
    "id": "FX_2_00",
    "label": "FX_2 frame 0",
    "path": "./assets/fx_2_00.webp",
    "replaceable": false
  }, {
    "id": "FX_2_01",
    "label": "FX_2 frame 1",
    "path": "./assets/fx_2_01.webp",
    "replaceable": false
  }, {
    "id": "FX_2_02",
    "label": "FX_2 frame 2",
    "path": "./assets/fx_2_02.webp",
    "replaceable": false
  }, {
    "id": "FX_2_03",
    "label": "FX_2 frame 3",
    "path": "./assets/fx_2_03.webp",
    "replaceable": false
  }, {
    "id": "FX_2_04",
    "label": "FX_2 frame 4",
    "path": "./assets/fx_2_04.webp",
    "replaceable": false
  }, {
    "id": "FX_2_05",
    "label": "FX_2 frame 5",
    "path": "./assets/fx_2_05.webp",
    "replaceable": false
  }, {
    "id": "FX_2_06",
    "label": "FX_2 frame 6",
    "path": "./assets/fx_2_06.webp",
    "replaceable": false
  }, {
    "id": "FX_2_07",
    "label": "FX_2 frame 7",
    "path": "./assets/fx_2_07.webp",
    "replaceable": false
  }, {
    "id": "FX_2_08",
    "label": "FX_2 frame 8",
    "path": "./assets/fx_2_08.webp",
    "replaceable": false
  }, {
    "id": "FX_2_09",
    "label": "FX_2 frame 9",
    "path": "./assets/fx_2_09.webp",
    "replaceable": false
  }, {
    "id": "FX_2_10",
    "label": "FX_2 frame 10",
    "path": "./assets/fx_2_10.webp",
    "replaceable": false
  }, {
    "id": "FX_2_11",
    "label": "FX_2 frame 11",
    "path": "./assets/fx_2_11.webp",
    "replaceable": false
  }, {
    "id": "FX_2_12",
    "label": "FX_2 frame 12",
    "path": "./assets/fx_2_12.webp",
    "replaceable": false
  }, {
    "id": "FX_2_13",
    "label": "FX_2 frame 13",
    "path": "./assets/fx_2_13.webp",
    "replaceable": false
  }, {
    "id": "FX_2_14",
    "label": "FX_2 frame 14",
    "path": "./assets/fx_2_14.webp",
    "replaceable": false
  }, {
    "id": "FX_2_15",
    "label": "FX_2 frame 15",
    "path": "./assets/fx_2_15.webp",
    "replaceable": false
  }, {
    "id": "FX_2_16",
    "label": "FX_2 frame 16",
    "path": "./assets/fx_2_16.webp",
    "replaceable": false
  }, {
    "id": "FX_2_17",
    "label": "FX_2 frame 17",
    "path": "./assets/fx_2_17.webp",
    "replaceable": false
  }, {
    "id": "FX_2_18",
    "label": "FX_2 frame 18",
    "path": "./assets/fx_2_18.webp",
    "replaceable": false
  }, {
    "id": "FX_2_19",
    "label": "FX_2 frame 19",
    "path": "./assets/fx_2_19.webp",
    "replaceable": false
  }, {
    "id": "FX_2_20",
    "label": "FX_2 frame 20",
    "path": "./assets/fx_2_20.webp",
    "replaceable": false
  }, {
    "id": "FX_2_21",
    "label": "FX_2 frame 21",
    "path": "./assets/fx_2_21.webp",
    "replaceable": false
  }, {
    "id": "FX_2_22",
    "label": "FX_2 frame 22",
    "path": "./assets/fx_2_22.webp",
    "replaceable": false
  }, {
    "id": "FX_2_23",
    "label": "FX_2 frame 23",
    "path": "./assets/fx_2_23.webp",
    "replaceable": false
  }, {
    "id": "FX_2_24",
    "label": "FX_2 frame 24",
    "path": "./assets/fx_2_24.webp",
    "replaceable": false
  }, {
    "id": "FX_2_25",
    "label": "FX_2 frame 25",
    "path": "./assets/fx_2_25.webp",
    "replaceable": false
  }, {
    "id": "FX_2_26",
    "label": "FX_2 frame 26",
    "path": "./assets/fx_2_26.webp",
    "replaceable": false
  }, {
    "id": "FX_2_27",
    "label": "FX_2 frame 27",
    "path": "./assets/fx_2_27.webp",
    "replaceable": false
  }, {
    "id": "FX_2_28",
    "label": "FX_2 frame 28",
    "path": "./assets/fx_2_28.webp",
    "replaceable": false
  }, {
    "id": "FX_3_00",
    "label": "FX_3 frame 0",
    "path": "./assets/fx_3_00.webp",
    "replaceable": false
  }, {
    "id": "FX_3_01",
    "label": "FX_3 frame 1",
    "path": "./assets/fx_3_01.webp",
    "replaceable": false
  }, {
    "id": "FX_3_02",
    "label": "FX_3 frame 2",
    "path": "./assets/fx_3_02.webp",
    "replaceable": false
  }, {
    "id": "FX_3_03",
    "label": "FX_3 frame 3",
    "path": "./assets/fx_3_03.webp",
    "replaceable": false
  }, {
    "id": "FX_3_04",
    "label": "FX_3 frame 4",
    "path": "./assets/fx_3_04.webp",
    "replaceable": false
  }, {
    "id": "FX_3_05",
    "label": "FX_3 frame 5",
    "path": "./assets/fx_3_05.webp",
    "replaceable": false
  }, {
    "id": "FX_3_06",
    "label": "FX_3 frame 6",
    "path": "./assets/fx_3_06.webp",
    "replaceable": false
  }, {
    "id": "FX_3_07",
    "label": "FX_3 frame 7",
    "path": "./assets/fx_3_07.webp",
    "replaceable": false
  }, {
    "id": "FX_3_08",
    "label": "FX_3 frame 8",
    "path": "./assets/fx_3_08.webp",
    "replaceable": false
  }, {
    "id": "FX_3_09",
    "label": "FX_3 frame 9",
    "path": "./assets/fx_3_09.webp",
    "replaceable": false
  }, {
    "id": "FX_3_10",
    "label": "FX_3 frame 10",
    "path": "./assets/fx_3_10.webp",
    "replaceable": false
  }, {
    "id": "FX_3_11",
    "label": "FX_3 frame 11",
    "path": "./assets/fx_3_11.webp",
    "replaceable": false
  }, {
    "id": "FX_3_12",
    "label": "FX_3 frame 12",
    "path": "./assets/fx_3_12.webp",
    "replaceable": false
  }, {
    "id": "FX_3_13",
    "label": "FX_3 frame 13",
    "path": "./assets/fx_3_13.webp",
    "replaceable": false
  }, {
    "id": "FX_3_14",
    "label": "FX_3 frame 14",
    "path": "./assets/fx_3_14.webp",
    "replaceable": false
  }, {
    "id": "FX_3_15",
    "label": "FX_3 frame 15",
    "path": "./assets/fx_3_15.webp",
    "replaceable": false
  }, {
    "id": "FX_3_16",
    "label": "FX_3 frame 16",
    "path": "./assets/fx_3_16.webp",
    "replaceable": false
  }, {
    "id": "FX_3_17",
    "label": "FX_3 frame 17",
    "path": "./assets/fx_3_17.webp",
    "replaceable": false
  }, {
    "id": "FX_3_18",
    "label": "FX_3 frame 18",
    "path": "./assets/fx_3_18.webp",
    "replaceable": false
  }, {
    "id": "FX_3_19",
    "label": "FX_3 frame 19",
    "path": "./assets/fx_3_19.webp",
    "replaceable": false
  }, {
    "id": "FX_3_20",
    "label": "FX_3 frame 20",
    "path": "./assets/fx_3_20.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_00",
    "label": "FX_FINAL frame 0",
    "path": "./assets/fx_final_00.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_01",
    "label": "FX_FINAL frame 1",
    "path": "./assets/fx_final_01.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_02",
    "label": "FX_FINAL frame 2",
    "path": "./assets/fx_final_02.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_03",
    "label": "FX_FINAL frame 3",
    "path": "./assets/fx_final_03.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_04",
    "label": "FX_FINAL frame 4",
    "path": "./assets/fx_final_04.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_05",
    "label": "FX_FINAL frame 5",
    "path": "./assets/fx_final_05.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_06",
    "label": "FX_FINAL frame 6",
    "path": "./assets/fx_final_06.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_07",
    "label": "FX_FINAL frame 7",
    "path": "./assets/fx_final_07.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_08",
    "label": "FX_FINAL frame 8",
    "path": "./assets/fx_final_08.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_09",
    "label": "FX_FINAL frame 9",
    "path": "./assets/fx_final_09.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_10",
    "label": "FX_FINAL frame 10",
    "path": "./assets/fx_final_10.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_11",
    "label": "FX_FINAL frame 11",
    "path": "./assets/fx_final_11.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_12",
    "label": "FX_FINAL frame 12",
    "path": "./assets/fx_final_12.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_13",
    "label": "FX_FINAL frame 13",
    "path": "./assets/fx_final_13.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_14",
    "label": "FX_FINAL frame 14",
    "path": "./assets/fx_final_14.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_15",
    "label": "FX_FINAL frame 15",
    "path": "./assets/fx_final_15.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_16",
    "label": "FX_FINAL frame 16",
    "path": "./assets/fx_final_16.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_17",
    "label": "FX_FINAL frame 17",
    "path": "./assets/fx_final_17.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_18",
    "label": "FX_FINAL frame 18",
    "path": "./assets/fx_final_18.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_19",
    "label": "FX_FINAL frame 19",
    "path": "./assets/fx_final_19.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_20",
    "label": "FX_FINAL frame 20",
    "path": "./assets/fx_final_20.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_21",
    "label": "FX_FINAL frame 21",
    "path": "./assets/fx_final_21.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_22",
    "label": "FX_FINAL frame 22",
    "path": "./assets/fx_final_22.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_23",
    "label": "FX_FINAL frame 23",
    "path": "./assets/fx_final_23.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_24",
    "label": "FX_FINAL frame 24",
    "path": "./assets/fx_final_24.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_25",
    "label": "FX_FINAL frame 25",
    "path": "./assets/fx_final_25.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_26",
    "label": "FX_FINAL frame 26",
    "path": "./assets/fx_final_26.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_27",
    "label": "FX_FINAL frame 27",
    "path": "./assets/fx_final_27.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_28",
    "label": "FX_FINAL frame 28",
    "path": "./assets/fx_final_28.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_29",
    "label": "FX_FINAL frame 29",
    "path": "./assets/fx_final_29.webp",
    "replaceable": false
  }, {
    "id": "FX_FINAL_30",
    "label": "FX_FINAL frame 30",
    "path": "./assets/fx_final_30.webp",
    "replaceable": false
  }]
};
const PACKAGE_HTML_STYLES = "@font-face{font-family:Poppins;src:url('./assets/fonts/Poppins-Regular.woff2') format('woff2');font-weight:400;font-display:swap}\n@font-face{font-family:Poppins;src:url('./assets/fonts/Poppins-Bold.woff2') format('woff2');font-weight:700;font-display:swap}\n:root{font-family:Poppins,Arial,sans-serif;color:#fff;background:#222;--ink:#fff;--ui:1;--accent:#ffcf4c}\n*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{overscroll-behavior:none}button{font:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}button:focus-visible{outline:3px solid #ffcd45;outline-offset:-5px}button:disabled{cursor:default}\n#stage{position:relative;width:100%;height:100%;isolation:isolate;overflow:hidden;touch-action:manipulation;color:var(--ink)}canvas{position:absolute;inset:0;width:100%;height:100%;display:block}\n#play{position:absolute;inset:0;border:0;background:none;z-index:1;padding:0;touch-action:manipulation;color:transparent}\n.makeover #play{touch-action:none}\n.hud{position:absolute;top:max(calc(30px * var(--ui)),env(safe-area-inset-top));left:calc(30px * var(--ui));right:calc(30px * var(--ui));display:flex;align-items:flex-start;justify-content:space-between;pointer-events:none;z-index:2;text-shadow:0 1px 4px #0009;font-size:calc(28px * var(--ui));font-weight:700;line-height:1.25;letter-spacing:-.6px;font-variant-numeric:tabular-nums}\n.hud.center{justify-content:center}.hud small{font-size:calc(14px * var(--ui));display:block;line-height:1.4;letter-spacing:0;font-weight:400;margin-top:3px}.hud span:empty{display:none}\n#guide{position:absolute;z-index:2;left:calc(30px * var(--ui));right:calc(30px * var(--ui));bottom:max(calc(62px * var(--ui)),env(safe-area-inset-bottom));font-size:calc(18px * var(--ui));font-weight:700;line-height:1.4;text-align:center;pointer-events:none;text-shadow:0 1px 4px #000a;animation:eh-guide-breathe 2.4s ease-in-out infinite;margin:0}\n#guide[hidden], [hidden]{display:none!important}html[data-feed-preview=\"true\"] #guide,html[data-feed-preview=\"true\"] .controls{visibility:hidden}.controls{position:absolute;z-index:3;left:calc(30px * var(--ui));right:calc(30px * var(--ui));bottom:max(calc(50px * var(--ui)),env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:center;gap:12px;pointer-events:none}\n.control{min-height:48px;min-width:48px;padding:10px 22px;border:0;border-radius:30px;background:#fff;color:#20252b;font-weight:700;font-size:16px;box-shadow:0 2px 10px #0002;pointer-events:auto}.control:active{transform:scale(.97)}#direction{margin-left:auto;border:1px solid #ffffff80;background:#2228;color:#fff;backdrop-filter:blur(8px);padding:10px 13px;display:flex;align-items:center;gap:8px}#direction svg{width:22px;height:22px;transition:transform .2s}\n#result{position:absolute;z-index:2;left:24px;right:24px;bottom:calc(122px * var(--ui));text-align:center;pointer-events:none;font-size:calc(28px * var(--ui));font-weight:700;line-height:1.2;text-shadow:0 2px 8px #0009}#result small{font-size:calc(18px * var(--ui));font-weight:400;display:block;margin-top:8px}\n#loading{position:absolute;inset:0;z-index:6;background:#25272a;display:grid;place-content:center;text-align:center;padding:30px;font-size:18px;line-height:1.5}#loading:before{content:'';width:28px;height:28px;border:3px solid #ffffff35;border-top-color:#fff;border-radius:50%;margin:0 auto 18px;animation:turn .8s linear infinite}#loading.error:before{display:none}.hair-catch{--ink:#30251e}.hair-catch .hud,.hair-catch #guide,.hair-catch #result{text-shadow:none}.hair-catch #guide{bottom:calc(70px * var(--ui))}.hair-catch .hud{top:calc(50px * var(--ui))}.hair-catch #result{bottom:calc(170px * var(--ui))}\n.hair-catch #guide{color:#fff;text-shadow:0 1px 4px #000b}.hair-catch .hud span:not(:empty){background:#fffef7ed;border-radius:24px;padding:6px 18px}.hair-shave #guide{bottom:calc(120px * var(--ui))}.makeover .hud{font-size:calc(24px * var(--ui))}.makeover .hud #left{max-width:75%}#pause{position:absolute;inset:0;z-index:7;background:#15191c90;display:grid;place-content:center;backdrop-filter:blur(4px)}#resume{border:1px solid #ffffff80;background:#fff;color:#222;font-size:18px;padding:15px 25px;border-radius:30px;min-height:50px}\n.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}@keyframes float{50%{transform:translateY(-5px)}}@keyframes turn{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*:before{animation:none!important;transition:none!important}}\n\n@keyframes eh-guide-breathe{0%,100%{opacity:1}50%{opacity:.6}}\nhtml[data-batch2-idle-paused=\"true\"] #guide{animation-play-state:paused}\n\n/* User follow-up 2026-11-02: common above-center CTA, above preview artwork. */\nhtml:root:root:root :is(#root,#game,#stage):is(#root,#game,#stage) p#guide{position:fixed!important;top:26%!important;bottom:auto!important;left:50%!important;right:auto!important;width:max-content!important;max-width:calc(100vw - 60px)!important;min-height:0!important;margin:0!important;text-align:center!important;translate:-50% -50%!important;transform:none!important;pointer-events:none!important;z-index:25!important;overflow-wrap:anywhere}\n\nhtml[data-feed-preview=\"true\"] #stage #guide:not([hidden]){visibility:visible!important;z-index:25!important}\n";
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
function startGame() {
  window.GAME_SPEC = {
    "id": "makeover",
    "title": "Cambio look",
    "settings": {
      "sequenceCount": 4,
      "moveSec": 0.35,
      "tapDelay": 0,
      "flashSec": 0.75,
      "taps": [3, 4, 3, 4],
      "vfxDuration": [1, 1, 1.05, 1.2]
    },
    "assets": {
      "looks": ["PHOTO_BASE", "PHOTO_SMILE", "PHOTO_SAD", "PHOTO_PUCKER", "PHOTO_GLAM"],
      "tools": ["TOOL_1", "TOOL_2", "TOOL_3", "TOOL_4"],
      "vfx": [["FX_0_00", "FX_0_01", "FX_0_02", "FX_0_03", "FX_0_04", "FX_0_05", "FX_0_06", "FX_0_07", "FX_0_08", "FX_0_09", "FX_0_10", "FX_0_11", "FX_0_12", "FX_0_13", "FX_0_14", "FX_0_15", "FX_0_16", "FX_0_17", "FX_0_18", "FX_0_19", "FX_0_20", "FX_0_21", "FX_0_22", "FX_0_23", "FX_0_24", "FX_0_25", "FX_0_26", "FX_0_27", "FX_0_28", "FX_0_29", "FX_0_30", "FX_0_31", "FX_0_32", "FX_0_33", "FX_0_34", "FX_0_35", "FX_0_36", "FX_0_37", "FX_0_38", "FX_0_39", "FX_0_40", "FX_0_41", "FX_0_42", "FX_0_43", "FX_0_44", "FX_0_45", "FX_0_46", "FX_0_47", "FX_0_48", "FX_0_49", "FX_0_50", "FX_0_51"], ["FX_1_00", "FX_1_01", "FX_1_02", "FX_1_03", "FX_1_04", "FX_1_05", "FX_1_06", "FX_1_07", "FX_1_08", "FX_1_09", "FX_1_10", "FX_1_11", "FX_1_12", "FX_1_13", "FX_1_14", "FX_1_15", "FX_1_16", "FX_1_17", "FX_1_18", "FX_1_19", "FX_1_20", "FX_1_21", "FX_1_22", "FX_1_23", "FX_1_24", "FX_1_25", "FX_1_26", "FX_1_27"], ["FX_2_00", "FX_2_01", "FX_2_02", "FX_2_03", "FX_2_04", "FX_2_05", "FX_2_06", "FX_2_07", "FX_2_08", "FX_2_09", "FX_2_10", "FX_2_11", "FX_2_12", "FX_2_13", "FX_2_14", "FX_2_15", "FX_2_16", "FX_2_17", "FX_2_18", "FX_2_19", "FX_2_20", "FX_2_21", "FX_2_22", "FX_2_23", "FX_2_24", "FX_2_25", "FX_2_26", "FX_2_27", "FX_2_28"], ["FX_3_00", "FX_3_01", "FX_3_02", "FX_3_03", "FX_3_04", "FX_3_05", "FX_3_06", "FX_3_07", "FX_3_08", "FX_3_09", "FX_3_10", "FX_3_11", "FX_3_12", "FX_3_13", "FX_3_14", "FX_3_15", "FX_3_16", "FX_3_17", "FX_3_18", "FX_3_19", "FX_3_20"]],
      "finalVfx": ["FX_FINAL_00", "FX_FINAL_01", "FX_FINAL_02", "FX_FINAL_03", "FX_FINAL_04", "FX_FINAL_05", "FX_FINAL_06", "FX_FINAL_07", "FX_FINAL_08", "FX_FINAL_09", "FX_FINAL_10", "FX_FINAL_11", "FX_FINAL_12", "FX_FINAL_13", "FX_FINAL_14", "FX_FINAL_15", "FX_FINAL_16", "FX_FINAL_17", "FX_FINAL_18", "FX_FINAL_19", "FX_FINAL_20", "FX_FINAL_21", "FX_FINAL_22", "FX_FINAL_23", "FX_FINAL_24", "FX_FINAL_25", "FX_FINAL_26", "FX_FINAL_27", "FX_FINAL_28", "FX_FINAL_29", "FX_FINAL_30"]
    },
    "photoFraming": {
      "x": 0.55,
      "y": 0.40,
      "screenY": 0.45,
      "zoom": 1.16
    },
    "photoPoints": {
      "mouth": {
        "x": 0.56,
        "y": 0.463
      },
      "eyes": [{
        "x": 0.452,
        "y": 0.353
      }, {
        "x": 0.69,
        "y": 0.393
      }],
      "face": {
        "x": 0.55,
        "y": 0.4
      }
    },
    "audio": {
      "BRUSH": "assets/brush.mp3",
      "HAMMER": "assets/hammer.mp3",
      "TISSUE": "assets/tissue.mp3",
      "MAKEUP": "assets/makeup.mp3",
      "TRANSITION": "assets/transition.mp3",
      "FINAL": "assets/final.mp3"
    }
  };
  (function (root) {
    'use strict';

    class Makeover {
      constructor(settings) {
        this.s = settings;
        this.reset();
      }
      reset() {
        this.state = 'waiting';
        this.stage = 0;
        this.taps = 0;
        this.contactDistance = 0;
        this.busy = 0;
        this.age = 0;
        this.transition = 0;
        this.events = [];
        this.actionAge = 99;
      }
      // User-approved drag override. Each old tap unit now requires 40 logical px
      // of pressed movement inside the relevant facial region, never idle time.
      stroke(distance) {
        if (!['waiting', 'playing'].includes(this.state) || this.busy > 0 || !Number.isFinite(distance) || distance <= 0) return false;
        this.state = 'playing';
        this.contactDistance += distance;
        while (this.contactDistance >= 40 && this.taps < this.s.taps[this.stage]) {
          this.contactDistance -= 40;
          this.taps++;
          this.age = 0;
          this.actionAge = 0;
          this.events.push({
            type: 'action',
            stage: this.stage,
            tap: this.taps
          });
        }
        if (this.taps >= this.s.taps[this.stage]) {
          this.contactDistance = 0;
          this.busy = this.s.moveSec + Math.max(0, this.s.vfxDuration[this.stage] + .05 - this.s.flashSec);
        }
        return true;
      }
      static contactDistance(from, to, zones) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (!Number.isFinite(distance) || distance === 0) return 0;
        const steps = Math.max(1, Math.ceil(distance / 4));
        let inside = 0;
        for (let i = 0; i < steps; i++) {
          const t = (i + .5) / steps,
            x = from.x + (to.x - from.x) * t,
            y = from.y + (to.y - from.y) * t;
          if (zones.some(z => ((x - z.x) / z.rx) ** 2 + ((y - z.y) / z.ry) ** 2 <= 1)) inside++;
        }
        return distance * inside / steps;
      }
      tick(dt) {
        this.actionAge += dt;
        if (this.state === 'transition') {
          this.transition += dt;
          if (this.transition >= this.s.flashSec) {
            if (this.stage + 1 >= this.s.sequenceCount) {
              this.state = 'result';
              this.events.push({
                type: 'result'
              });
            } else {
              this.stage++;
              this.taps = 0;
              this.contactDistance = 0;
              this.state = 'waiting';
              this.busy = 0;
              this.events.push({
                type: 'stage',
                stage: this.stage
              });
            }
          }
          return;
        }
        if (this.state !== 'playing' || this.busy <= 0) return;
        this.busy = Math.max(0, this.busy - dt);
        this.age += dt;
        if (this.busy === 0 && this.taps >= this.s.taps[this.stage]) {
          this.state = 'transition';
          this.transition = 0;
          this.events.push({
            type: 'transition',
            stage: this.stage
          });
        }
      }
      drain() {
        const e = this.events;
        this.events = [];
        return e;
      }
    }
    root.Makeover = Makeover;
  })(typeof window !== 'undefined' ? window : globalThis);

  /* BATCH2_IDLE_20261102 */
  /* Game-owned, silent demonstration clock. Never dispatches gameplay input. */
  (() => {
    'use strict';

    if (window.PlayableIdlePreview) return;
    const query = new URLSearchParams(location.search);
    const hosted = query.get('feedReview') === '1' || query.get('host') === 'fyp';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let preview = hosted,
      elapsed = 0,
      last = performance.now();
    const listeners = new Set();
    const sync = () => {
      const html = document.documentElement;
      html.dataset.batch2Idle = String(preview);
      html.dataset.batch2IdlePaused = String(document.hidden);
      html.dataset.batch2IdleReduced = String(reduced.matches);
      if (!preview) for (const node of document.querySelectorAll('[data-idle-preview]')) node.dataset.idlePreview = 'off';
      last = performance.now();
      for (const fn of listeners) fn(preview && !document.hidden);
    };
    const clock = () => {
      const now = performance.now();
      if (preview && !document.hidden && !reduced.matches) elapsed += Math.min(64, Math.max(0, now - last));
      last = now;
      return reduced.matches ? 1600 : elapsed;
    };
    const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
    const ease = t => (t = clamp(t), t * t * (3 - 2 * t));
    const trace = (ctx, points, progress = 1) => {
      if (!points.length) return;
      const distances = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      let left = distances.reduce((a, b) => a + b, 0) * clamp(progress);
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1],
          q = points[i],
          d = distances[i - 1];
        const t = Math.min(1, left / Math.max(.01, d));
        ctx.lineTo(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
        left -= d;
        if (left <= 0) break;
      }
      ctx.stroke();
    };
    const onPath = (points, progress) => {
      const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
      let distance = lengths.reduce((a, b) => a + b, 0) * clamp(progress);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          length = lengths[i - 1];
        if (distance <= length || i === points.length - 1) {
          const t = clamp(distance / Math.max(.01, length));
          return {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
          };
        }
        distance -= length;
      }
      return points[0];
    };
    const stamp = (canvas, kind, phase = clock()) => {
      if (!canvas) return;
      canvas.dataset.idlePreview = preview ? kind : 'off';
      canvas.dataset.idlePhase = String(Math.round(phase));
    };
    function ant(ctx, w, h, image) {
      const t = clock() / 1000,
        p = t % 5.4 / 5.4;
      const cx = w * .5,
        cy = h * .51,
        rx = Math.min(w * .29, 105),
        ry = Math.min(h * .16, 78);
      const path = Array.from({
        length: 81
      }, (_, i) => ({
        x: cx + Math.cos(i / 80 * Math.PI * 2) * rx,
        y: cy + Math.sin(i / 80 * Math.PI * 2) * ry
      }));
      ctx.save();
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#242322';
      ctx.globalAlpha = p > .88 ? (1 - p) / .12 : 1;
      trace(ctx, path, ease(p / .48));
      const x = cx + Math.sin(t * 2.1) * rx * .63,
        y = cy + Math.sin(t * 2.8) * ry * .59;
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(Math.cos(t * 2.8) * ry, Math.cos(t * 2.1) * rx) + Math.PI / 2);
      if (image?.complete && image.naturalWidth) ctx.drawImage(image, -17, -17, 34, 34);else {
        ctx.fillStyle = '#242322';
        for (const [y, r] of [[-7, 5], [0, 4], [7, 6]]) {
          ctx.beginPath();
          ctx.ellipse(0, y, r, r * 1.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      stamp(ctx.canvas, 'ant-loop');
    }
    function army(state, w, h) {
      const t = clock() / 1000;
      const players = state.entities.filter(e => e.team === 'player'),
        cx = players.reduce((n, e) => n + e.x, 0) / Math.max(1, players.length),
        cy = players.reduce((n, e) => n + e.y, 0) / Math.max(1, players.length);
      return {
        ...state,
        particles: [],
        playerTarget: {
          x: w * (.5 + Math.sin(t * .8) * .18),
          y: h * (.43 + Math.cos(t * .8) * .04)
        },
        entities: state.entities.map((entity, i) => ({
          ...entity,
          x: entity.team === 'player' ? w * (.5 + Math.sin(t * .8) * .14) + (entity.x - cx) * .7 : entity.x + Math.sin(t * 1.5 + i * .7) * 8,
          y: entity.team === 'player' ? h * (.57 + Math.cos(t * .8) * .04) + (entity.y - cy) * .7 : entity.y + Math.cos(t * 1.5 + i * .7) * 8
        }))
      };
    }
    function blade(ctx, w, h, top, bottom) {
      const t = clock() / 1000,
        p = t % 5.8 / 5.8,
        cx = w / 2,
        cy = (top + bottom) / 2;
      const points = [[-.22, .16], [-.11, .02], [.04, .04], [.17, -.17], [.24, -.11]].map(([x, y]) => ({
        x: cx + x * w,
        y: cy + y * (bottom - top)
      }));
      ctx.save();
      ctx.strokeStyle = '#303936';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = p > .9 ? (1 - p) / .1 : 1;
      if (p < .5) trace(ctx, points, ease(p / .45));else {
        ctx.translate(cx, cy);
        ctx.rotate((p - .5) * Math.PI * 3.4);
        trace(ctx, points.map(v => ({
          x: v.x - cx,
          y: v.y - cy
        })));
        ctx.fillStyle = '#303936';
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      stamp(ctx.canvas, 'draw-and-spin-blade');
    }
    function roadPose(key) {
      const t = clock() / 1000,
        offset = key === 'player' ? 0 : key === 'copL' ? 1.3 : 2.2;
      const q = t * .75 - offset,
        x = 375 + Math.sin(q) * 130,
        y = key === 'player' ? 800 : 1040 + (key === 'copR' ? 60 : 0);
      return {
        x: x + (key === 'copL' ? -85 : key === 'copR' ? 85 : 0),
        y: y + Math.cos(q) * 28,
        angle: -Math.PI / 2 + Math.cos(q) * .18
      };
    }
    function road(ctx) {
      const p = roadPose('player');
      ctx.save();
      ctx.strokeStyle = '#ffffff88';
      ctx.setLineDash([11, 12]);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(p.x + 100, p.y - 100, 340, p.y - 220, 420, p.y - 340);
      ctx.stroke();
      ctx.restore();
      stamp(ctx.canvas, 'escape-route');
    }
    function route(start, end, circles, w) {
      const nodes = [start, end];
      for (const circle of circles) for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6,
          r = circle.circleRadius + 16;
        const p = {
          x: circle.position.x + Math.cos(a) * r,
          y: circle.position.y + Math.sin(a) * r
        };
        if (p.x > 15 && p.x < w - 15) nodes.push(p);
      }
      const distance = nodes.map(() => Infinity),
        previous = nodes.map(() => -1),
        visited = new Set();
      distance[0] = 0;
      const clear = (a, b) => circles.every(c => {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          t = clamp(((c.position.x - a.x) * dx + (c.position.y - a.y) * dy) / Math.max(.01, dx * dx + dy * dy));
        return Math.hypot(a.x + dx * t - c.position.x, a.y + dy * t - c.position.y) > c.circleRadius + 7;
      });
      for (let pass = 0; pass < nodes.length; pass++) {
        let k = -1;
        for (let j = 0; j < nodes.length; j++) if (!visited.has(j) && (k < 0 || distance[j] < distance[k])) k = j;
        if (k < 0 || !Number.isFinite(distance[k])) break;
        if (k === 1) break;
        visited.add(k);
        for (let j = 0; j < nodes.length; j++) {
          if (visited.has(j) || !clear(nodes[k], nodes[j])) continue;
          const d = distance[k] + Math.hypot(nodes[k].x - nodes[j].x, nodes[k].y - nodes[j].y);
          if (d < distance[j]) {
            distance[j] = d;
            previous[j] = k;
          }
        }
      }
      if (previous[1] < 0) return [start, {
        x: 20,
        y: start.y + 24
      }, {
        x: 20,
        y: end.y - 28
      }, end];
      const path = [];
      for (let k = 1; k >= 0; k = previous[k]) {
        path.unshift(nodes[k]);
        if (k === 0) break;
      }
      return path;
    }
    let sodaCache = null;
    function soda(ctx, source, cup, cupW, cupH, bodies, w) {
      if (!source || !cup) return;
      const t = clock() / 1000,
        p = t % 5.6;
      const circles = bodies.filter(b => b.label === 'obstacle'),
        key = JSON.stringify([source, cup, w, circles.map(c => [c.position.x, c.position.y, c.circleRadius])]);
      if (sodaCache?.key !== key) sodaCache = {
        key,
        points: route({
          x: source.x,
          y: source.y + 21
        }, {
          x: cup.x,
          y: cup.y - cupH * .42
        }, circles, w)
      };
      const points = sodaCache.points;
      ctx.save();
      ctx.strokeStyle = '#242322';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = p > 5 ? (5.6 - p) / .6 : 1;
      trace(ctx, points, ease(p / 1.7));
      if (p > 1.4 && p < 5) {
        for (let i = 0; i < 15; i++) {
          const q = (p - 1.4) * .65 - i * .067;
          if (q < 0 || q > 1) continue;
          const at = onPath(points, q);
          ctx.fillStyle = '#59c6b1';
          ctx.strokeStyle = '#242322';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(at.x, at.y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      stamp(ctx.canvas, 'guided-soda-route');
    }
    const style = document.createElement('style');
    style.dataset.batch2IdleStyle = '';
    style.textContent = `
    html[data-batch2-idle=true] .idle-memory-deck{display:block}
    .idle-memory-deck{position:absolute;inset:0;display:none;overflow:hidden;pointer-events:none}
    .idle-memory-deck img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;animation:idle-memory-photo 7.2s linear infinite}
    .idle-memory-deck img:nth-child(2){animation-delay:-4.8s}.idle-memory-deck img:nth-child(3){animation-delay:-2.4s}
    .idle-clean-tool{display:none;position:absolute;z-index:5;left:var(--idle-clean-x,25%);top:var(--idle-clean-y,54%);width:76px;height:95px;pointer-events:none;transform:translate(-50%,-35%)}
    .idle-clean-tool>span{display:none;width:100%;height:100%}.idle-clean-tool img{width:100%;height:100%;object-fit:contain}
    html[data-batch2-idle=true] .idle-clean-tool{display:block}
    [data-idle-clean-tool=spray] .idle-clean-spray,[data-idle-clean-tool=brush] .idle-clean-brush,[data-idle-clean-tool=rinse] .idle-clean-rinse{display:block}
    html[data-batch2-idle=true] .video-window>img{visibility:hidden}
    @keyframes idle-memory-photo{0%,29%{opacity:1;transform:scale(1)}33%,96%{opacity:0;transform:scale(1.035)}100%{opacity:1;transform:scale(1)}}
    html[data-batch2-idle=true] .tool-swing{animation:idle-tool-hit 2.6s ease-in-out infinite!important;transform-origin:70% 75%}
    html[data-batch2-idle=true] .target-art{animation:idle-stick-react 2.6s ease-in-out infinite!important;transform-origin:50% 75%}
    @keyframes idle-tool-hit{0%,32%,100%{transform:translate(10px,5px) rotate(-25deg)}46%{transform:translate(-30px,-8px) rotate(-64deg)}55%,70%{transform:translate(6px,7px) rotate(-20deg)}}
    @keyframes idle-stick-react{0%,45%,72%,100%{transform:rotate(0) scale(1)}50%{transform:translate(-4px,2px) rotate(-3deg) scale(1.025,.97)}60%{transform:rotate(1.5deg) scale(.99,1.01)}}
    html[data-batch2-idle-paused=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation-play-state:paused!important}
    html[data-batch2-idle-reduced=true] :is(.idle-memory-deck img,.tool-swing,.target-art){animation:none!important}
    html[data-batch2-idle-reduced=true] .idle-memory-deck img:first-child{opacity:1}
  `;
    document.head.append(style);
    window.PlayableIdlePreview = Object.freeze({
      get active() {
        return preview && !document.hidden;
      },
      get preview() {
        return preview;
      },
      get reduced() {
        return reduced.matches;
      },
      get seconds() {
        return clock() / 1000;
      },
      clock,
      ease,
      clamp,
      stamp,
      trace,
      onPath,
      ant,
      army,
      blade,
      road,
      roadPose,
      soda,
      subscribe(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    });
    addEventListener('message', event => {
      if (parent === window || event.source !== parent || event.origin !== location.origin || event.data?.type !== 'playable-active') return;
      const next = event.data.active !== true;
      if (next !== preview) {
        preview = next;
        elapsed = 0;
      }
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    reduced.addEventListener?.('change', sync);
    addEventListener('pagehide', () => {
      preview = false;
      sync();
      listeners.clear();
    }, {
      once: true
    });
    sync();
  })();
  window.createGame = function (R) {
    const {
        ctx: c,
        spec: s
      } = R,
      a = s.assets,
      m = new window.Makeover(s.settings),
      names = ["Lava i denti", "Prova il sorriso", "Asciuga le lacrime", "È l'ora del trucco"],
      verbs = ["Trascina per spazzolare", "Trascina sul viso", "Trascina per asciugare", "Trascina per sfumare"],
      sounds = ['BRUSH', 'HAMMER', 'TISSUE', 'MAKEUP'];
    let dragging = false,
      lastPoint = null,
      toolPoint = null,
      buzz = null,
      contactGrace = 0,
      resultAge = 0;
    const scale = () => Math.min(R.w / 390, R.h / 598),
      rest = () => ({
        x: R.w * .72,
        y: R.h * .71 - (document.documentElement?.dataset.feedPreview === 'true' ? 28 * scale() : 0)
      });
    function zones() {
      const p = s.photoPoints,
        points = m.stage === 0 ? [p.mouth] : m.stage === 2 ? p.eyes : [p.face];
      return points.map(point => ({
        ...R.point(a.looks[0], point),
        rx: R.w * [.15, .21, .10, .21][m.stage],
        ry: R.h * [.065, .18, .065, .18][m.stage]
      }));
    }
    function inZone(p) {
      return zones().some(z => ((p.x - z.x) / z.rx) ** 2 + ((p.y - z.y) / z.ry) ** 2 <= 1);
    }
    function stopContact() {
      R.stop(buzz);
      buzz = null;
      contactGrace = 0;
    }
    function end() {
      dragging = false;
      lastPoint = null;
      toolPoint = null;
      stopContact();
    }
    function reset() {
      end();
      m.reset();
      resultAge = 0;
      R.guide(R.config.texts.find(t => t.id === 'GUIDE')?.value || verbs[0]);
      R.result('');
      R.setAction("Trascina sulla bocca per spazzolare. Usa le frecce per piccoli movimenti.");
      document.getElementById('play').disabled = false;
    }
    function move(p) {
      if (!dragging || !lastPoint || !['waiting', 'playing'].includes(m.state) || m.busy > 0) return;
      const d = window.Makeover.contactDistance(lastPoint, p, zones()) / scale();
      lastPoint = p;
      toolPoint = p;
      if (m.stroke(d)) {
        R.guide('', false);
        contactGrace = .12;
        if (!buzz) buzz = R.sound(sounds[m.stage], m.stage === 1 ? .24 : .32, true);
        R.announce(names[m.stage] + ', ' + Math.min(100, Math.round((m.taps + m.contactDistance / 40) / s.settings.taps[m.stage] * 100)) + " per cento");
      } else stopContact();
    }
    return {
      inputMode: 'drag',
      reset,
      state: () => ({
        state: m.state,
        stage: m.stage,
        progress: m.taps + m.contactDistance / 40,
        dragging,
        busy: m.busy
      }),
      isPlaying: () => ['playing', 'transition'].includes(m.state),
      pause: end,
      pointerStart(p) {
        if (!['waiting', 'playing'].includes(m.state) || m.busy > 0) return false;
        const r = rest();
        if (!inZone(p) && Math.hypot(p.x - r.x, p.y - r.y) > R.w * .16) return false;
        dragging = true;
        lastPoint = p;
        toolPoint = p;
        return true;
      },
      pointerMove: move,
      pointerEnd: end,
      keyStroke(key) {
        if (!['waiting', 'playing'].includes(m.state) || m.busy > 0) return;
        const z = zones()[0],
          step = 16 * scale(),
          v = {
            ArrowLeft: [-1, 0],
            ArrowRight: [1, 0],
            ArrowUp: [0, -1],
            ArrowDown: [0, 1]
          }[key];
        dragging = true;
        lastPoint = {
          x: z.x - step * v[0] / 2,
          y: z.y - step * v[1] / 2
        };
        move({
          x: z.x + step * v[0] / 2,
          y: z.y + step * v[1] / 2
        });
        end();
      },
      update(dt) {
        m.tick(dt);
        contactGrace = Math.max(0, contactGrace - dt);
        if (!contactGrace) stopContact();
        for (const e of m.drain()) {
          if (e.type === 'stage') {
            R.releaseInput();
            R.setAction(verbs[m.stage] + ". Usa le frecce per piccoli movimenti.");
            R.guide(verbs[m.stage]);
          }
          if (e.type === 'transition') {
            R.releaseInput();
            R.sound('TRANSITION', .25);
          }
          if (e.type === 'result') {
            R.releaseInput();
            R.sound('FINAL', .38);
            R.result('Beautiful');
            R.announce("Look completato");
          }
        }
        if (m.state === 'result') resultAge += dt;
        const progress = Math.min(100, Math.round((m.taps + m.contactDistance / 40) / s.settings.taps[m.stage] * 100)),
          stageEl = document.getElementById('stage');
        stageEl.dataset.stage = String(m.stage);
        stageEl.dataset.progress = String(progress);
        stageEl.dataset.dragging = String(dragging);
        document.getElementById('play').disabled = m.state === 'result';
        R.hud(m.state === 'result' ? '' : names[m.stage], m.state === 'result' ? '' : progress + '%');
      },
      draw(t) {
        if (window.PlayableIdlePreview.active) {
          const time = window.PlayableIdlePreview.seconds,
            p = time % 4.6,
            z = zones()[0],
            brush = Math.sin(time * 9),
            travel = R.clamp((p - .5) / .65, 0, 1),
            resting = rest();
          R.photo(a.looks[0]);
          if (p > 1.1 && p < 3.9) R.photo(a.looks[1], Math.sin((p - 1.1) / 2.8 * Math.PI) * .82);
          const x = R.mix(resting.x, z.x + brush * R.w * .065, travel),
            y = R.mix(resting.y, z.y + Math.sin(time * 4) * R.h * .009, travel);
          R.sprite(a.tools[0], x, y, R.w * .24, null, brush * .035, 1, {
            x: .71,
            y: .19
          });
          window.PlayableIdlePreview.stamp(R.canvas, 'brush-teeth');
          return;
        }
        const stage = m.stage;
        R.photo(a.looks[stage]);
        if (m.state === 'transition') {
          const p = R.clamp(m.transition / s.settings.flashSec, 0, 1);
          R.photo(a.looks[stage + 1 >= s.settings.sequenceCount ? 4 : stage + 1], p);
        }
        if (m.state === 'result') {
          R.photo(a.looks[4]);
          R.frame(a.finalVfx, resultAge, 2, R.w / 2, R.h / 2, R.w, R.h, true);
          return;
        }
        if (m.state === 'waiting') {
          c.save();
          c.strokeStyle = '#fff';
          c.globalAlpha = .65;
          c.lineWidth = 1.5 * scale();
          c.setLineDash([4 * scale(), 5 * scale()]);
          for (const z of zones()) {
            c.beginPath();
            c.ellipse(z.x, z.y, z.rx * .8, z.ry * .8, 0, 0, Math.PI * 2);
            c.stroke();
          }
          c.restore();
        }
        const p = toolPoint || rest(),
          toolW = R.w * [.24, .30, .28, .30][stage],
          anchor = [{
            x: .71,
            y: .19
          }, {
            x: .70,
            y: .24
          }, {
            x: .50,
            y: .45
          }, {
            x: .70,
            y: .18
          }][stage];
        R.sprite(a.tools[stage], p.x, p.y, toolW, null, 0, 1, anchor);
        if (m.actionAge < s.settings.vfxDuration[stage]) {
          const dest = zones()[0];
          if (stage === 2) {
            for (const eye of zones()) R.frame(a.vfx[stage], m.actionAge, s.settings.vfxDuration[stage], eye.x, eye.y + R.h * .08, R.w * .16);
          } else R.frame(a.vfx[stage], m.actionAge, s.settings.vfxDuration[stage], dest.x, dest.y, R.w * [.27, .70, .16, .75][stage]);
        }
      }
    };
  };
  (function () {
    'use strict';

    const el = id => document.getElementById(id),
      canvas = el('canvas'),
      ctx = canvas.getContext('2d', {
        alpha: false
      }),
      spec = window.GAME_SPEC;
    const images = {},
      config = {},
      hosted = new URLSearchParams(location.search).get('host') === 'fyp' || new URLSearchParams(location.search).get('feedReview') === '1';
    let running = false,
      hidden = false,
      hostActive = !hosted,
      paused = false,
      last = 0,
      age = 0,
      app;
    document.documentElement.dataset.feedPreview = String(hosted && !hostActive);
    const soundNodes = new Set(),
      voices = new Set();
    let ac;
    const R = window.Playable = {
      spec,
      images,
      ctx,
      canvas,
      w: 390,
      h: 598,
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
      config,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      mix: (a, b, p) => a + (b - a) * p,
      ease: p => 1 - Math.pow(1 - p, 3),
      cover(id) {
        const im = images[id],
          f = spec.photoFraming,
          s = Math.max(R.w / im.width, R.h / im.height) * (f?.zoom || 1),
          w = im.width * s,
          h = im.height * s;
        let y = f ? R.h * f.screenY - h * f.y : (R.h - h) / 2;
        if (f?.topLandmark !== undefined) y = Math.max(y, R.h * f.minTop - h * f.topLandmark);
        return {
          x: f ? R.clamp(R.w * .5 - w * f.x, R.w - w, 0) : (R.w - w) / 2,
          y: R.clamp(y, R.h - h, 0),
          w,
          h
        };
      },
      photo(id, alpha = 1) {
        const p = R.cover(id);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.drawImage(images[id], p.x, p.y, p.w, p.h);
        ctx.restore();
        return p;
      },
      point(id, p) {
        const b = R.cover(id);
        return {
          x: b.x + b.w * p.x,
          y: b.y + b.h * p.y
        };
      },
      sprite(id, x, y, w, h, rotation = 0, alpha = 1, anchor = {
        x: .5,
        y: .5
      }) {
        const im = images[id];
        if (!im || !Number.isFinite(x + y + w)) return;
        h = h ?? w * im.height / im.width;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.globalAlpha = alpha;
        ctx.drawImage(im, -w * anchor.x, -h * anchor.y, w, h);
        ctx.restore();
      },
      frame(ids, t, duration, x, y, w, h, loop = false) {
        if (t < 0 || !loop && t >= duration) return;
        if (loop && R.reduced) t = duration * .5;
        const n = Math.min(ids.length - 1, Math.floor((loop ? t % duration : t) / duration * ids.length));
        for (let ahead = 0; ahead < 3; ahead++) {
          const index = loop ? (n + ahead) % ids.length : n + ahead;
          if (index < ids.length) loadAsset(ids[index]).catch(() => {});
        }
        let index = n;
        while (index >= Math.max(0, n - 3) && !images[ids[index]]) index--;
        if (index >= Math.max(0, n - 3)) R.sprite(ids[index], x, y, w, h);
      },
      hud(left = '', right = '', center = false) {
        el('left').textContent = left;
        el('right').textContent = right;
        el('hud').classList.toggle('center', center);
      },
      guide(text, show = true) {
        el('guide').textContent = text;
        el('guide').hidden = !show;
      },
      result(title, sub = '') {
        el('resultTitle').textContent = title;
        el('resultSub').textContent = sub;
        el('result').hidden = !title;
        el('retry').hidden = !title;
      },
      announce(text) {
        el('status').textContent = text;
      },
      unlock() {
        try {
          ac ??= new (window.AudioContext || window.webkitAudioContext)();
          if (ac.state === 'suspended') ac.resume().catch(() => {});
        } catch {}
      },
      tone(kind = 'good') {
        if (!ac || ac.state !== 'running') return;
        const now = ac.currentTime,
          o = ac.createOscillator(),
          g = ac.createGain();
        o.type = kind === 'bad' ? 'triangle' : 'sine';
        o.frequency.setValueAtTime(kind === 'bad' ? 230 : 650, now);
        o.frequency.exponentialRampToValueAtTime(kind === 'bad' ? 130 : 900, now + .12);
        g.gain.setValueAtTime(.0001, now);
        g.gain.exponentialRampToValueAtTime(0.2, now + .008);
        g.gain.exponentialRampToValueAtTime(.0001, now + .17);
        o.connect(g);
        g.connect(ac.destination);
        o.start();
        o.stop(now + .19);
        voices.add(o);
        o.onended = () => {
          voices.delete(o);
          o.disconnect();
          g.disconnect();
        };
      },
      sound(key, volume = .5, loop = false) {
        const path = spec.audio[key];
        if (!path) return null;
        const a = new Audio(path);
        a.volume = volume;
        a.loop = loop;
        soundNodes.add(a);
        a.addEventListener('ended', () => soundNodes.delete(a), {
          once: true
        });
        a.play().catch(() => {
          soundNodes.delete(a);
        });
        return a;
      },
      stop(a) {
        if (a) {
          a.pause();
          a.currentTime = 0;
          soundNodes.delete(a);
        }
      },
      silence() {
        for (const a of soundNodes) R.stop(a);
        for (const o of voices) {
          try {
            o.stop();
          } catch {}
        }
        voices.clear();
      },
      setAction(label) {
        el('play').setAttribute('aria-label', label);
      },
      releaseInput() {
        endPointer();
      },
      setDirection(show, fn) {
        el('direction').hidden = !show;
        el('direction').onclick = () => {
          if (paused || !hostActive) return;
          R.unlock();
          fn();
        };
      },
      debug: () => ({
        state: app?.state?.(),
        paused,
        hostActive,
        hidden,
        loaded: Object.keys(images).length,
        sounds: soundNodes.size
      })
    };
    // Keep startup independent of optional animation frames and bound decode work.
    const assetSlots = new Map(),
      assetJobs = new Map(),
      assetQueue = [],
      frameCache = new Map(),
      frameFailures = new Map();
    let assetLoads = 0,
      assetAlive = true,
      frameStamp = 0,
      booting = false;
    const effectSlot = id => /^FX_/.test(id),
      frameLimit = 12;
    function trimFrames() {
      while (frameCache.size > frameLimit) {
        let oldest = null,
          stamp = Infinity;
        for (const [id, time] of frameCache) if (time < stamp) {
          oldest = id;
          stamp = time;
        }
        frameCache.delete(oldest);
        const image = images[oldest];
        delete images[oldest];
        if (image) image.removeAttribute('src');
      }
    }
    function readImage(slot, attempt = 0) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        const done = error => {
          clearTimeout(timer);
          image.onload = null;
          image.onerror = null;
          if (error) {
            image.removeAttribute('src');
            reject(error);
          } else resolve(image);
        };
        const timer = setTimeout(() => done(Error("Tempo di caricamento dell'immagine scaduto: " + slot.id)), 12000);
        image.onload = () => done(image.naturalWidth > 0 && image.naturalHeight > 0 ? null : Error("L'immagine è vuota: " + slot.id));
        image.onerror = () => done(Error("Impossibile caricare l'immagine: " + slot.id));
        // load/naturalWidth works even when the optional decode() promise is rejected
        // under memory pressure. Canvas decodes only the images it actually paints.
        image.src = slot.path + (attempt ? (slot.path.includes('?') ? '&' : '?') + 'retry=' + attempt : '');
      });
    }
    function pumpAssets() {
      while (assetAlive && assetLoads < 3 && assetQueue.length) {
        const job = assetQueue.shift();
        assetLoads++;
        (async () => {
          let image;
          try {
            image = await readImage(job.slot);
          } catch (first) {
            if (!assetAlive) throw first;
            image = await readImage(job.slot, 1);
          }
          if (!assetAlive) {
            image.removeAttribute('src');
            return null;
          }
          images[job.slot.id] = image;
          if (effectSlot(job.slot.id)) {
            frameFailures.delete(job.slot.id);
            frameCache.set(job.slot.id, ++frameStamp);
            trimFrames();
          }
          return image;
        })().then(job.resolve, error => {
          if (effectSlot(job.slot.id)) {
            frameFailures.set(job.slot.id, performance.now());
            job.resolve(null);
          } else job.reject(error);
        }).finally(() => {
          assetLoads--;
          assetJobs.delete(job.slot.id);
          pumpAssets();
        });
      }
    }
    function loadAsset(id) {
      if (images[id]) {
        if (effectSlot(id)) frameCache.set(id, ++frameStamp);
        return Promise.resolve(images[id]);
      }
      if (assetJobs.has(id)) return assetJobs.get(id);
      const slot = assetSlots.get(id);
      if (!slot) return Promise.reject(Error("Immagine mancante: " + id));
      if (effectSlot(id) && (frameFailures.has(id) && performance.now() - frameFailures.get(id) < 2500 || assetJobs.size >= 6)) return Promise.resolve(null);
      let resolve, reject;
      const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      });
      assetJobs.set(id, promise);
      const job = {
        slot,
        resolve,
        reject
      };
      effectSlot(id) ? assetQueue.push(job) : assetQueue.unshift(job);
      pumpAssets();
      return promise;
    }
    window.addEventListener('pagehide', () => {
      assetAlive = false;
      for (const job of assetQueue.splice(0)) job.resolve(null);
      for (const [id, image] of Object.entries(images)) {
        image.removeAttribute('src');
        delete images[id];
      }
      frameCache.clear();
      assetJobs.clear();
    }, {
      once: true
    });
    function size() {
      const b = canvas.getBoundingClientRect();
      R.w = b.width;
      R.h = b.height;
      const d = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(b.width * d);
      canvas.height = Math.round(b.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      document.documentElement.style.setProperty('--ui', Math.min(b.width / 390, b.height / 598));
      app?.resize?.();
    }
    function reset() {
      endPointer();
      R.silence();
      paused = false;
      el('pause').hidden = true;
      R.result('');
      el('direction').hidden = true;
      app.reset();
      R.announce('Ready');
      if (running) app.draw(0);
      last = 0;
    }
    function point(e) {
      const b = canvas.getBoundingClientRect();
      return {
        x: e.clientX - b.left,
        y: e.clientY - b.top
      };
    }
    function canInput() {
      return running && !paused && hostActive && !hidden;
    }
    function action(e) {
      if (!canInput() || app.inputMode === 'drag') return;
      R.unlock();
      const p = e ? point(e) : {
        x: R.w / 2,
        y: R.h * .70
      };
      app.action(p);
    }
    let down = null;
    function endPointer() {
      const d = down;
      down = null;
      app?.pointerEnd?.();
      if (d && el('play').hasPointerCapture?.(d.id)) el('play').releasePointerCapture(d.id);
    }
    el('play').addEventListener('pointerdown', e => {
      if (e.isPrimary === false || e.button !== 0 || !canInput()) return;
      if (app.inputMode === 'drag') {
        R.unlock();
        if (!app.pointerStart(point(e))) return;
        e.preventDefault();
        down = {
          id: e.pointerId
        };
        el('play').setPointerCapture(e.pointerId);
        return;
      }
      down = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY
      };
    });
    el('play').addEventListener('pointermove', e => {
      if (app?.inputMode !== 'drag' || !down || e.pointerId !== down.id) return;
      if (!canInput() || e.buttons === 0) {
        endPointer();
        return;
      }
      e.preventDefault();
      app.pointerMove(point(e));
    });
    el('play').addEventListener('pointercancel', e => {
      if (down && e.pointerId === down.id) endPointer();
    });
    el('play').addEventListener('lostpointercapture', e => {
      if (down && e.pointerId === down.id) endPointer();
    });
    el('play').addEventListener('pointerup', e => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      if (app.inputMode === 'drag') {
        endPointer();
        return;
      }
      down = null;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 18) return;
      action(e);
    });
    el('play').addEventListener('click', e => {
      if (e.detail === 0) action();
    });
    el('play').addEventListener('keydown', e => {
      if (!canInput() || !app.keyStroke || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      R.unlock();
      app.keyStroke(e.key);
    });
    el('retry').onclick = () => {
      R.unlock();
      reset();
    };
    el('resume').onclick = () => {
      R.unlock();
      paused = false;
      el('pause').hidden = true;
      app.resume?.();
      last = 0;
    };
    function pause() {
      endPointer();
      R.silence();
      app?.pause?.();
      if (running && app?.isPlaying?.()) {
        paused = true;
        el('pause').hidden = false;
      }
    }
    document.addEventListener('visibilitychange', () => {
      hidden = document.hidden;
      if (hidden) pause();
      last = 0;
    });
    window.addEventListener('blur', pause);
    window.addEventListener('resize', size);
    // Only the parent frame can control activity; never accept commands from sibling windows.
    window.addEventListener('message', e => {
      if (e.source !== parent || parent === window) return;
      const d = e.data;
      if (d?.type === 'playable-active' && typeof d.active === 'boolean') {
        hostActive = d.active;
        document.documentElement.dataset.feedPreview = String(!hostActive);
        if (!hostActive && running) {
          pause();
          reset();
        }
        last = 0;
      }
    });
    function palette() {
      if (parent === window) return;
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 48;
      const x = c.getContext('2d');
      x.drawImage(canvas, 0, 0, 32, 48);
      try {
        parent.postMessage({
          type: 'playable-palette',
          top: Array.from(x.getImageData(0, 0, 32, 12).data),
          bottom: Array.from(x.getImageData(0, 36, 32, 12).data)
        }, location.origin);
      } catch {}
    }
    function loop(t) {
      requestAnimationFrame(loop);
      if (!running || hidden || paused) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(.05, (t - last) / 1000) : 0;
      last = t;
      age += dt;
      if (hostActive) app.update(dt);else app.previewUpdate?.(dt);
      app.draw(age);
      const state = app.state?.().state;
      if (el('stage').dataset.state !== state) el('stage').dataset.state = state;
    }
    async function boot() {
      if (booting || running) return;
      booting = true;
      const loading = el('loading');
      loading.hidden = false;
      loading.classList.remove('error');
      loading.textContent = "Caricamento…";
      frameFailures.clear();
      try {
        const c = await fetch('./game.config.json', {
          cache: 'no-store'
        }).then(r => {
          if (!r.ok) throw Error("Impossibile caricare la configurazione");
          return r.json();
        });
        Object.assign(config, c);
        for (const t of c.tweaks || []) if (typeof t.value === 'number' && Number.isFinite(t.value)) spec.settings[t.id] = R.clamp(t.value, t.min ?? -Infinity, t.max ?? Infinity);
        for (const slot of c.images || []) {
          if (!slot.path || /^(https?:|data:)/.test(slot.path)) throw Error("L'immagine deve usare un percorso locale relativo: " + slot.id);
          assetSlots.set(slot.id, slot);
        }
        // Only portraits, tools and the result frame are required for the first view.
        // Effect frames load as they are used and never hold up the playable.
        await Promise.all([...assetSlots.keys()].filter(id => !effectSlot(id)).map(loadAsset));
        if (!assetAlive) return;
        document.title = spec.title;
        el('stage').className = spec.id;
        app = window.createGame(R);
        size();
        reset();
        app.draw(0);
        running = true;
        loading.hidden = true;
        document.documentElement.dataset.playableLoading = 'false';
        palette();
        requestAnimationFrame(loop);
      } catch (error) {
        running = false;
        loading.hidden = false;
        loading.classList.add('error');
        loading.textContent = "Impossibile caricare il gioco. " + error.message + ' ';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = "Tocca per riprovare";
        retry.style.cssText = 'display:block;margin:16px auto 0;padding:12px 20px;border:0;border-radius:24px;font:600 16px system-ui;cursor:pointer';
        retry.onclick = () => {
          booting = false;
          boot();
        };
        loading.append(retry);
        console.error(error);
      } finally {
        booting = false;
      }
    }
    boot();
  })();

  /* Decorative CTA breathing only. No positions, inputs, clocks or game state. */
  (() => {
    const selectors = ["p#guide"],
      copy = new Set(["Trascina per spazzolare"].map(s => s.replace(/\s+/g, ' ').trim().toLowerCase()));
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)'),
      running = new Map();
    let queued = false,
      visible = true;
    const action = /^(?:(?:tap|drag|hold|swipe|draw|use|press|click|release|brush|pull|touch|pinch|rub|move|trace)\b|spray\s*[→-]|tocca\b|trascina\b|tieni\b|scorri\b|disegna\b|premi\b|点击|轻触|滑动|按住|拖动|长按|双击)/i;
    function scan() {
      queued = false;
      for (const [el, a] of running) if (!el.isConnected) {
        a.cancel();
        running.delete(el);
      }
      if (motion.matches) {
        for (const a of running.values()) a.cancel();
        running.clear();
        return;
      }
      const targets = new Set();
      for (const selector of selectors) {
        try {
          document.querySelectorAll(selector).forEach(el => targets.add(el));
        } catch {}
      }
      for (const el of document.querySelectorAll('p,span,div,label,text')) {
        if (el.children.length || el.closest('button,a,input,select,textarea,[role="button"]')) continue;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length >= 5 && text.length <= 140 && (copy.has(text.toLowerCase()) || !selectors.length && action.test(text))) targets.add(el);
      }
      for (const el of targets) {
        if (running.has(el) || typeof el.animate !== 'function') continue;
        if ([...targets].some(child => child !== el && el.contains(child))) continue;
        const style = getComputedStyle(el);
        if (/breath/i.test(style.animationName)) continue;
        const base = style.filter.replace(/opacity\([^)]*\)/g, '').replace(/^none$/, '').trim(),
          filter = v => (base ? base + ' ' : '') + 'opacity(' + v + ')';
        const a = el.animate([{
          filter: filter(1)
        }, {
          filter: filter(.65)
        }, {
          filter: filter(1)
        }], {
          duration: 2400,
          iterations: Infinity,
          easing: 'ease-in-out'
        });
        running.set(el, a);
        if (document.hidden || !visible) a.pause();
      }
    }
    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(scan);
      }
    };
    const pause = () => {
      for (const a of running.values()) document.hidden || !visible ? a.pause() : a.play();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
    const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries.some(e => e.isIntersecting);
      pause();
    }) : null;
    if (document.body) intersection?.observe(document.body);else document.addEventListener('DOMContentLoaded', () => intersection?.observe(document.body), {
      once: true
    });
    document.addEventListener('visibilitychange', pause);
    motion.addEventListener?.('change', schedule);
    schedule();
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      intersection?.disconnect();
      for (const a of running.values()) a.cancel();
      running.clear();
    }, {
      once: true
    });
  })();
}
function App() {
  React.useEffect(() => {
    startGame();
  }, []);
  return <><main {...{
      "id": "stage"
    }}><canvas {...{
        "id": "canvas",
        "aria-hidden": "true"
      }}></canvas><button {...{
        "id": "play",
        "aria-label": "Gioca"
      }}></button><div {...{
        "id": "hud",
        "className": "hud",
        "aria-hidden": "true"
      }}><span {...{
          "id": "left"
        }}></span><span {...{
          "id": "right"
        }}></span></div><p {...{
        "id": "guide"
      }}></p><div {...{
        "id": "result",
        "hidden": true
      }}><span {...{
          "id": "resultTitle"
        }}></span><small {...{
          "id": "resultSub"
        }}></small></div><div {...{
        "className": "controls"
      }}><button {...{
          "id": "retry",
          "className": "control",
          "hidden": true
        }}>{"Again"}</button><button {...{
          "id": "direction",
          "className": "control",
          "hidden": true,
          "aria-label": "Cambia direzione di rasatura"
        }}><svg {...{
            "viewBox": "0 0 24 24",
            "fill": "none",
            "stroke": "currentColor",
            "strokeWidth": "2",
            "aria-hidden": "true"
          }}><path {...{
              "d": "M6 17V4m-3 3 3-3 3 3m9 0v13m-3-3 3 3 3-3"
            }}></path></svg><span>{"Direction"}</span></button></div><div {...{
        "id": "pause",
        "hidden": true
      }}><button {...{
          "id": "resume"
        }}>{"Tocca per continuare"}</button></div><div {...{
        "id": "loading",
        "role": "status"
      }}>{"Caricamento…"}</div><div {...{
        "id": "status",
        "role": "status",
        "aria-live": "polite",
        "className": "sr"
      }}></div></main></>;
}
ReactDOM.createRoot(document.getElementById("root")).render(<><style>{PACKAGE_HTML_STYLES}</style>{<App />}</>);
