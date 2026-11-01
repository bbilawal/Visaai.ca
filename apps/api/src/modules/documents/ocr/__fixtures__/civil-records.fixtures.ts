/**
 * OCR text shaped like the real documents from the 2026-10-15 dry run (Canada
 * visitor visa, Pakistani parent). Layout and labels are transcribed from the
 * originals; the Urdu rendering OCR returns beside each English value is kept
 * because it is what the parser actually has to read around. Names, numbers
 * and addresses are the anonymised test identities already used across this
 * suite — no images are committed.
 */

/** Government of Punjab / NADRA CRMS "Birth Registration Certificate" — one child. */
export const PUNJAB_BIRTH_CERT_SAJAWAL = `حکومت پنجاب
Government of Punjab
I09079004
اندراج پیدائش سرٹیفکیٹ
Birth Registration Certificate
Form No: I09079004
CRMS No: B100626-17-10687
دفتر اندراج :میونسپل کارپوریشن راولپنڈی
OLD/M REG #: 11138/1989
Child's Details
بچے کے کوائف
Name :
MIAN MUHAMMAD SAJAWAL
میاں محمد سجاول
نام :
Date of Birth :
14-October-1989
14-October-1989
تاریخ پیدائش :
Gender :
Male
Religion : ISLAM
مذہب : اسلام
مرد
جنس :
District of Birth: RAWALPINDI
پیدائش کا ضلع : راولپنڈی
Parental Information
والدین کی معلومات
Father's Name : MUZAFFAR AHMAD
والد کا نام : مظفر احمد
Nationality :
Pakistani
قومیت : پاکستانی
CNIC No :
37405-5309209-7
37405-5309209-7
شناختی کارڈ نمبر :
Mother's Name : SUMERA AHMAD
والدہ کا نام : سمیرا احمد
Nationality :
Pakistani
CNIC No :
37405-0486358-7
37405-0486358-7
Grand Father's Name : MIAN ABDUL RASHEED
دادا کا نام : میاں عبدالرشید
CNIC No:
Address
پتہ
Address :
House No. 138 , Mohalla Millat Colony , City RAWALPINDI ,
Tehsil :
RAWALPINDI
District :
RAWALPINDI
Applicant's Details
درخواست دہندہ کے کوائف
Name :
MUZAFFAR AHMAD
مظفر احمد
CNIC No :
37405-5309209-7
Relation of Child: SON
بیٹا
Entry Date :
19-November-1989
Issue Date :
05-June-2017
Entry Status :
Normal
Senior Data Processing Officer
Municipal Corporation Rawalpindi
10062610100207`;

/** The same layout, the twin — the second page of "Birth Certificate Children.pdf". */
export const PUNJAB_BIRTH_CERT_BILAWAL = `حکومت پنجاب
Government of Punjab
Tracking Id: 10062610109645
CRMS No: B100626-17-10721
OLD/M REG #: 11137/1989
Birth Registration Certificate
Form No: X10549201
Child's Details
Name :
MIAN MUHAMMAD BILAWAL
میاں محمد بلاول
Date of Birth :
14-October-1989
Gender :
Male
Religion : ISLAM
District of Birth: RAWALPINDI
Parental Information
Father's Name : MUZAFFAR AHMAD
Nationality :
Pakistani
CNIC No :
37405-5309209-7
Mother's Name : SUMERA AHMAD
Nationality :
Pakistani
CNIC No :
37405-0486358-7
Grand Father's Name : MIAN ABDUL RASHEED
CNIC No:
Applicant's Details
Name :
MUZAFFAR AHMAD
CNIC No :
37405-5309209-7
Relation of Child: SON
Entry Date :
19-November-1989
Issue Date :
21-March-2019
Entry Status :
Normal
This Certificate can be verified at https://crms.nadra.gov.pk/verify`;

/** "Birth Certificate Children.pdf": both certificates in ONE upload. */
export const PUNJAB_BIRTH_CERTS_TWO_CHILDREN = `${PUNJAB_BIRTH_CERT_SAJAWAL}\n${PUNJAB_BIRTH_CERT_BILAWAL}`;

/**
 * A grandchild's certificate: the parents are the applicant's son and
 * daughter-in-law, not the applicant.
 */
export const PUNJAB_BIRTH_CERT_GRANDCHILD = PUNJAB_BIRTH_CERT_SAJAWAL.replace(
  /MIAN MUHAMMAD SAJAWAL/g,
  'AYAT BILAWAL',
)
  .replace(/14-October-1989/g, '03-March-2021')
  .replace(/Male\n/g, 'Female\n')
  .replace(
    /Father's Name : MUZAFFAR AHMAD/,
    "Father's Name : MIAN MUHAMMAD BILAWAL",
  )
  .replace(/Mother's Name : SUMERA AHMAD/, "Mother's Name : FARHANA CHOUDHRY")
  .replace(/37405-5309209-7/g, '37405-1111111-1')
  .replace(/37405-0486358-7/g, '37405-2222222-2');

/** Ontario "BIRTH CERTIFICATE / CERTIFICAT DE NAISSANCE" wallet card. */
export const ONTARIO_BIRTH_CERT = `OFFICIAL DOCUMENT ~ DOCUMENT OFFICIEL
The names and date may not agree with information provided on your application, but the
certificate is issued exactly as recorded on the birth registration.
95-399337-6-01
--- RUKHSANA CHOUDHRY
--- 7732 REDSTONE RD
--- MALTON, ON
L6T 2B9
CANADA
ONTARIO
BIRTH CERTIFICATE
CERTIFICAT DE NAISSANCE
NAME—NOM
CHOUDHRY, FARHANA ARSHED
DATE OF BIRTH—DATE DE NAISSANCE
SEPTEMBER 02,1995
CERTIFICATE NUMBER
NUMERO DU CERTIFICAT
95-399337-01
BIRTHPLACE—LIEU DE NAISSANCE
SCARBOROUGH
SEX—SEXE
F
DATE OF REGISTRATION
DE L'ENREGISTREMENT
NOV. 22,1995
REGISTRATION NUMBER
NUMÉRO DE L'ENREGISTREMENT
95-05-097097
ISSUED IN THE PROVINCE OF ONTARIO
JAN. 05,1996
CERTIFIED EXTRACT FROM BIRTH REGISTRATION
FORM 28 VITAL STATISTICS ACT
(REGISTRAR GENERAL)`;

/**
 * Nikah nama: handwritten Urdu pages (OCR returns fragments of them, including
 * a stray "1999"-looking scrawl) followed by the typed English Form No. 4.
 */
export const NIKAH_NAMA = `نکاح نامہ
42
16-9-88
نکاح خواں کا نام
16-9-1999
Muzaffar Ahmad
Sumera Bano
NIKAH REGISTRAR
18. Has the bridegroom given the right of Divorce to the bride. If given on what condition?
23. The name of the Nikah reader along with his father's name and reidence
Hafiz Mohammad Hazrat Rasvi S/O Seohat Khan, Khatib Jamah Masjid Nerani, Gawalmandi, Rawalpindi
24. The date when the marriage was registered ........16=9-1988.......................
25 The fees of registration paid...........Rs.2/= Only.
The signature of the bridegroom along with the signature of his attorney ....—Sd—....
The signature of the Nikah Readsa....—Sd—....
Form No. 4
(See Rule No. 8, 10)
The Prescribed form according to the Rules No. 8 and 10 of the
Muslim Family ordinance issued in 1968, (8, 1961).
42/288
Nikah Nama
1. Ward No.....3.........Town/Union..........The Police Station.....Rawalpindi
the District..........Rawalpindi..........Where the Marriage was held.
2. The name of the bridegroom? Muzaffar Ahmad S/O Mian Abdul Rashid
his father along with his residence..H/NO:138, Millat Coloney, Rawalpindi.
3 The bridegroom age .................25 Years
4 The name of the bride & her fathers Sumera Bano D/O Mohammad Ali
along with her residence. H/NO:Z/1115,Mohallah Taza Gul, Dhoke Ratta
5 Whether bride is a vergin, vidow or divorced.....Virgin..........—Rawalpindi.
6 The bride age ...........20 Years
7. The name of an attorney if appointed on behalf of the bride along with his fathers name and residence. Babu Mohammad Bashir S/O Mohammad Din
11. The name of the witnesses of the marriage along with their names their father's names & residence 1.Prof. Abdul Latif Khaki S/O Mohammad Aziz, BIV/1391, Muslim Town, Rawalpindi.
12. The date when the marriage was celebrated ........16 - 9 - 1988 ........-K/535,Millat Colon
13. The amount of Mahar. ..........Rs.1000/= Only.`;

/** Pakistani CNIC (front) of the applicant's wife. */
export const CNIC_SPOUSE = `PAKISTAN National Identity Card
ISLAMIC REPUBLIC OF PAKISTAN
Name
Sumera Ahmad
Husband Name
Muzaffar Ahmad
Gender Country of Stay
F Pakistan
Identity Number Date of Birth
37405-0486358-2 09.10.1968
Date of Issue Date of Expiry
12.06.2017 12.06.2027
Holder's Signature`;

/** Pakistani CNIC (front) of the applicant himself. */
export const CNIC_APPLICANT = `PAKISTAN National Identity Card
ISLAMIC REPUBLIC OF PAKISTAN
Name
Muzaffar Ahmad
Father Name
Mian Abdul Rasheed
Gender Country of Stay
M Pakistan
Identity Number Date of Birth
37405-5309209-7 15.06.1961
Date of Issue Date of Expiry
24.04.2017 24.04.2027
Holder's Signature`;
