# MEDICAL TEST // **BAYES** :star:
_Probability · a positive test, really ill? · clean copy_
> [coral] QUESTION: A disease affects **1%** of people. The test is positive for **95%** of the ill and gives a false positive for **5%** of the healthy. If someone tests positive, how likely are they to be ill?
!columns 48
## **Givens**
1. P(I) = 0.01 ((ill))
2. P(+|I) = 0.95 ((true positive))
3. P(+|I') = 0.05 ((false positive))
4. P(I') = 0.99 ((1 − 0.01))
!col
!draw 400
<svg viewBox="0 0 470 260">
  <line x1="40" y1="130" x2="190" y2="58" stroke="#1f2233" stroke-width="2"/>
  <line x1="40" y1="130" x2="190" y2="202" stroke="#1f2233" stroke-width="2"/>
  <line x1="232" y1="58" x2="360" y2="58" stroke="#1f2233" stroke-width="2"/>
  <line x1="232" y1="202" x2="360" y2="202" stroke="#1f2233" stroke-width="2"/>
  <circle cx="30" cy="130" r="12" fill="#ffe066" stroke="#1f2233" stroke-width="1.5"/>
  <circle cx="211" cy="58" r="21" fill="#ffb48a" stroke="#1f2233" stroke-width="1.5"/>
  <circle cx="211" cy="202" r="21" fill="#8fc3ff" stroke="#1f2233" stroke-width="1.5"/>
  <text x="201" y="66" font-size="22">I</text>
  <text x="197" y="210" font-size="22">I'</text>
  <text x="76" y="76" font-size="20" fill="#e9573f">0.01</text>
  <text x="76" y="204" font-size="20" fill="#2f7fd6">0.99</text>
  <text x="262" y="46" font-size="20" fill="#e9573f">+: 0.95</text>
  <text x="262" y="190" font-size="20" fill="#2f7fd6">+: 0.05</text>
  <text x="370" y="65" font-size="22" fill="#e9573f">0.0095</text>
  <text x="370" y="209" font-size="22" fill="#2f7fd6">0.0495</text>
</svg>
!end
!end
## Step by **step**
1. Total probability: P(+) = 0.95·0.01 + 0.05·0.99 = ==0.059==
2. Bayes' rule: P(I|+) = P(+|I)·P(I) / P(+)
3. Substitute: P(I|+) = 0.0095 / 0.059 ≈ **0.16**
## Intuition with **1000 people**
>> [sky] 10 ILL: 9.5 people test positive ((true alarm)) || [purple] 990 HEALTHY: 49.5 people test positive ((false alarm))
!zone amber
!stat 16% of those who test positive are really ill
!sticky [yellow] Why so low?: The disease is **rare**; false positives outnumber the truly ill.
!end
