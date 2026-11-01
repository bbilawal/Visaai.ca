# Redistribution review worksheet

`visa_sources.redistribution` decides one thing: whether VisaAI may keep a copy
of the bytes an authority served. All 385 registered sources are `unknown`,
which the pipeline treats as **do not cache** — so `kb_blobs.storage_path` is
null throughout and the `visa-knowledge` bucket is empty.

## What is and is not affected

Nothing about answers changes. Extraction, chunking, embedding, retrieval and
citation all work on text held in `kb_chunk_texts`; the citation points at the
authority's own URL, which is where it should point regardless of this setting.
Change detection is unaffected too — it compares hashes, and the hashes are
recorded either way.

What is lost is the ability to show which exact document version an answer came
from **after the authority removes or rewrites it**. That is a real loss for a
withdrawn PDF and a small one for a page that Wayback already mirrors.

## Current exposure: none, yet

As of 2026-09-04 every active version in production is `text/html`. Zero PDFs.
So flipping any authority to `permitted` today would cache HTML pages that are
mostly still live at their URLs — worth doing, but not urgent.

The urgency arrives with the first authority that publishes requirements as a
PDF bulletin, because a withdrawn PDF is what nobody can recover. Decide this
before onboarding one, not after.

## How to fill this in

For each authority, read the site's own terms — usually "Terms of use",
"Copyright", "Legal notices", or a national open-licence page (`OGL` in the UK,
`Open Government Licence – Canada`, `17 U.S.C. §105` for US federal works,
`CC BY` across much of the EU). Record the verdict and the URL you read it on.

Then set it:

```sql
-- one authority at a time, with the evidence in the commit message
update public.visa_sources
   set redistribution = 'permitted'   -- or 'prohibited'
 where authority = '<authority>';
```

`permitted` means "we may store and re-serve the bytes". `prohibited` means
"link only" and is the same behaviour as `unknown` — the difference is that
`prohibited` records that someone checked.

Leave `unknown` where the terms are genuinely silent. It is the honest value and
it is not a gap in this table.

| Authority | Sources | Active | Host | Verdict | Terms URL read |
|---|---:|---:|---|---|---|
| U.S. Citizenship and Immigration Services | 50 | 50 | https://ceac.state.gov | | |
| Immigration, Refugees and Citizenship Canada | 41 | 41 | https://ircc.canada.ca | | |
| Department of Home Affairs | 32 | 32 | https://immi.homeaffairs.gov.au | | |
| UK Visas and Immigration | 32 | 32 | https://visas-immigration.service.gov.uk | | |
| Ministry of Manpower (MOM) | 21 | 21 | https://www.mom.gov.sg | | |
| Service-Public.gouv.fr — Direction de l'information légale et administrative (DILA) | 18 | 18 | https://www.service-public.gouv.fr | | |
| AIMA — Agência para a Integração, Migrações e Asilo | 17 | 17 | https://aima.gov.pt | | |
| General Directorate of General Security (Lebanon) | 16 | 16 | https://www.general-security.gov.lb | | |
| Ministry of Foreign Affairs of the Republic of Türkiye | 16 | 16 | https://www.mfa.gov.tr | | |
| Presidency of Migration Management (Göç İdaresi Başkanlığı) | 13 | 13 | https://en.goc.gov.tr | | |
| Immigration Services Agency (出入国在留管理庁) | 13 | 13 | https://www.moj.go.jp | | |
| Maahanmuuttovirasto (Finnish Immigration Service, Migri) | 12 | 12 | https://migri.fi | | |
| Migration Platform of the Austrian Federal Government | 11 | 11 | https://www.migration.gv.at | | |
| Immigration & Checkpoints Authority (ICA) | 10 | 10 | https://www.ica.gov.sg | | |
| Utlendingsdirektoratet (UDI) | 10 | 10 | https://www.udi.no | | |
| SIRI — the Danish Agency for International Recruitment and Integration | 7 | 7 | https://www.nyidanmark.dk | | |
| Immigration New Zealand | 7 | 7 | https://www.immigration.govt.nz | | |
| National Immigration Administration (NIA) | 6 | 6 | https://en.nia.gov.cn | | |
| Ministry of Labour (وزارة العمل) | 6 | 6 | https://www.mol.gov.om | | |
| Immigration Service Delivery | 6 | 6 | https://www.irishimmigration.ie | | |
| Immigratie- en Naturalisatiedienst (IND) | 6 | 6 | https://ind.nl | | |
| U.S. Customs and Border Protection | 4 | 4 | https://www.cbp.gov | | |
| Immigration Department of the Hong Kong Special Administrative Region | 4 | 4 | https://www.immd.gov.hk | | |
| Migrationsverket (Swedish Migration Agency) | 4 | 4 | https://www.migrationsverket.se | | |
| Federal Authority for Identity, Citizenship, Customs & Port Security (ICP) | 3 | 3 | https://icp.gov.ae | | |
| Department of Consular Affairs, Ministry of Foreign Affairs (กรมการกงสุล) | 3 | 3 | https://consular.mfa.go.th | | |
| Migrationsverket | 3 | 3 | https://www.migrationsverket.se | | |
| Jabatan Imigresen Malaysia (Immigration Department of Malaysia) | 3 | 3 | https://www.imi.gov.my | | |
| Danish Immigration Service (Udlændingestyrelsen) | 3 | 3 | https://www.nyidanmark.dk | | |
| Immigration Service Delivery (ISD) | 2 | 2 | https://www.irishimmigration.ie | | |
| U.S. Immigration and Customs Enforcement — Student and Exchange Visitor Program | 2 | 2 | https://studyinthestates.dhs.gov | | |
| Government of Jordan — national eGovernment portal | 1 | 1 | https://jordan.gov.jo | | |
| Ministry of Interior — Arab Republic of Egypt | 1 | 1 | https://visa2egypt.gov.eg | | |
| Immigration New Zealand (INZ) | 1 | 1 | https://www.immigration.govt.nz | | |
| Ministry of Foreign Affairs — Consular Affairs Department | 1 | 1 | https://mofa.gov.qa | | |

## Suggested order

1. **IRCC, USCIS, UKVI, Home Affairs** — the four largest, and the four most
   likely to publish a PDF next. US federal works are generally not
   copyrightable; Canada and the UK both run named open licences. These are
   likely quick `permitted` verdicts with a citable licence URL.
2. **The EU authorities** (AIMA, IND, Migri, UDI, Migrationsverket, SIRI, the
   Austrian platform, DILA) — most publish under a CC or national open licence,
   but the licence differs per country and DILA in particular has its own terms.
3. **Everyone else** — smaller footprints; `unknown` costs little until one of
   them starts publishing PDFs.

## Do not

Do not set `permitted` because a page is publicly reachable. Public and
redistributable are different questions, and the whole point of the column is
that the second one was actually asked.
