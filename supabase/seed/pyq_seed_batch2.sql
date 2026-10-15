-- PYQ seed · batch 2 — WBJEE 2026, MHT-CET 2026, CBSE Class 12 2026
-- Real questions from the Vedam PYQ Drive, figure-free and answer-key verified.
-- Marking follows each exam's real scheme (needs migration 0015).
-- Run AFTER 0014 + 0015. Safe to read; NOT idempotent (run once per database).

-- ---------------------------------------------------------------- papers
insert into public.pyq_papers (exam, subject, year, set_label, title, marks_correct, marks_wrong, marking_note, source_file_id, is_published, sort_order) values
('WBJEE','Physics',2026,'24 May 2026','WBJEE 2026 · Physics',1,-0.25,'Category 1: +1 / −¼ · Category 2: +2 / −½','1q5q_ofioJKZAtnRZt0nU0s5ccqdyrLjp',true,10),
('WBJEE','Chemistry',2026,'24 May 2026','WBJEE 2026 · Chemistry',1,-0.25,'Category 1: +1 / −¼ · Category 2: +2 / −½','1q5q_ofioJKZAtnRZt0nU0s5ccqdyrLjp',true,20),
('WBJEE','Mathematics',2026,'24 May 2026','WBJEE 2026 · Mathematics',1,-0.25,'Category 1: +1 / −¼ · Category 2: +2 / −½','1q5q_ofioJKZAtnRZt0nU0s5ccqdyrLjp',true,30),
('MHT-CET','Physics',2026,'11 April · Shift 2','MHT-CET 2026 · Physics · 11 April Shift 2',1,0,'+1 correct · no negative marking','17rzvrCvKxtlDH5QL6voc8kl1yqCkvdWI',true,10),
('MHT-CET','Chemistry',2026,'11 April · Shift 2','MHT-CET 2026 · Chemistry · 11 April Shift 2',1,0,'+1 correct · no negative marking','17rzvrCvKxtlDH5QL6voc8kl1yqCkvdWI',true,20),
('CBSE Class 12','Physics',2026,'Set 1 · 55/1/1','CBSE Class 12 2026 · Physics · Section A',1,0,'Section A: +1 correct · no negative marking','1zqIBWZFXM4ks7JBgJRUxU1O0-54LPhKN',true,10),
('CBSE Class 12','Chemistry',2026,'Set 1 · 56/1/1','CBSE Class 12 2026 · Chemistry · Section A',1,0,'Section A: +1 correct · no negative marking','1T6ZZwf9g2fCP2TaxgcSJwJJaSRkQzJul',true,20),
('CBSE Class 12','Mathematics',2026,'Set 1 · 65/1/1','CBSE Class 12 2026 · Mathematics · Section A',1,0,'Section A: +1 correct · no negative marking','13cUKia7kCFB1QpnXtPHr5xnY9LpaaCEN',true,30),
('CBSE Class 12','Computer Science',2026,'Set 4 · 91','CBSE Class 12 2026 · Computer Science · Section A',1,0,'Section A: +1 correct · no negative marking','1-q5DMkYxy2ZJhyMyjkWRA0a0pRdllYmR',true,40);

-- ------------------------------------------------------- WBJEE Mathematics
with p as (select id from public.pyq_papers where exam='WBJEE' and subject='Mathematics' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Matrices',$s$If f(x) = (1 + x)/(1 − x) and A is a matrix such that A^3 = 0, then f(A) =$s$,
 $s$[{"key":"A","text":"I + 2A + 2A^2"},{"key":"B","text":"I + 2A + A^2"},{"key":"C","text":"I − 2A + A^2"},{"key":"D","text":"I + A + A^2"}]$s$,'A',
 $s$f(x) = (1 + x)(1 − x)^(−1) = (1 + x)(1 + x + x^2 + x^3 + …) = 1 + 2x + 2x^2 + 2x^3 + … Putting x = A and using A^3 = 0 gives f(A) = I + 2A + 2A^2.$s$,1::numeric,-0.25::numeric),
(2,'Relations',$s$On the set R of real numbers, the relation ρ defined by x ρ y (x, y ∈ R) iff —$s$,
 $s$[{"key":"A","text":"|x − y| < 2 is reflexive but neither symmetric nor transitive"},{"key":"B","text":"|x| ≥ y is reflexive and transitive but not symmetric"},{"key":"C","text":"x > |y| is transitive but neither reflexive nor symmetric"},{"key":"D","text":"x − y < 2 is reflexive and symmetric but not transitive"}]$s$,'C',
 $s$x > |y| is transitive (x > |y| and y > |z| give x > |z|) but not reflexive (x > |x| fails) and not symmetric. The other options are mis-stated: |x − y| < 2 is symmetric, |x| ≥ y is not transitive, and x − y < 2 is not symmetric.$s$,1,-0.25),
(3,'Sequences and Series',$s$Let a1, a2, a3, … be in G.P. such that n > m, an > am, a1 + an = 66 and a2·a(n−1) = 128. If a1 + a2 + … + an = 126, then n is$s$,
 $s$[{"key":"A","text":"11"},{"key":"B","text":"8"},{"key":"C","text":"6"},{"key":"D","text":"64"}]$s$,'C',
 $s$In a G.P., a1·an = a2·a(n−1) = 128 and a1 + an = 66, so a1 = 2 and an = 64. The sum (an·r − a1)/(r − 1) = 126 gives r = 2. Then 2^(n−1) = 32, so n = 6.$s$,1,-0.25),
(4,'Trigonometric Equations',$s$The general solution of the equation sin^100 x − cos^100 x = 1 is$s$,
 $s$[{"key":"A","text":"{2nπ + π/3 : n ∈ I}"},{"key":"B","text":"{nπ + π/4 : n ∈ I}"},{"key":"C","text":"{nπ ± π/2 : n ∈ I}"},{"key":"D","text":"{2nπ − π/3 : n ∈ I}"}]$s$,'C',
 $s$Since sin^100 x ≤ 1 and cos^100 x ≥ 0, the equation forces sin^100 x = 1 and cos^100 x = 0, so sin^2 x = 1 and x = nπ ± π/2.$s$,1,-0.25),
(5,'Probability',$s$If 'a' is an integer lying in [−5, 30], then the probability that the graph of y = x^2 + 2(a + 4)x − 5a + 64 lies above the x-axis is$s$,
 $s$[{"key":"A","text":"1/6"},{"key":"B","text":"7/36"},{"key":"C","text":"2/9"},{"key":"D","text":"3/5"}]$s$,'C',
 $s$The upward parabola stays above the x-axis when its discriminant is negative: a^2 + 13a − 48 < 0, so a ∈ (−16, 3). There are 36 integers in [−5, 30], and 8 of them (−5 to 2) lie in (−16, 3). P = 8/36 = 2/9.$s$,1,-0.25)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- ----------------------------------------------------------- WBJEE Physics
with p as (select id from public.pyq_papers where exam='WBJEE' and subject='Physics' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Waves',$s$The equation of a transverse wave is y = y0·sin[2π(ft − x/λ)]. If the maximum particle velocity is four times the wave velocity, then$s$,
 $s$[{"key":"A","text":"λ = π·y0/4"},{"key":"B","text":"λ = π·y0/2"},{"key":"C","text":"λ = π·y0"},{"key":"D","text":"λ = 2π·y0"}]$s$,'B',
 $s$Maximum particle velocity = y0·2πf and wave velocity = fλ. Setting y0·2πf = 4fλ gives λ = π·y0/2.$s$,1::numeric,-0.25::numeric),
(2,'Ray Optics',$s$A person has a minimum distance of distinct vision of 50 cm. The power of the lens required to read a book at a distance of 25 cm is$s$,
 $s$[{"key":"A","text":"3 D"},{"key":"B","text":"1 D"},{"key":"C","text":"2 D"},{"key":"D","text":"5 D"}]$s$,'C',
 $s$The lens must image an object at 25 cm at the near point of 50 cm: 1/f = 1/v − 1/u = 1/(−0.50) − 1/(−0.25) = −2 + 4 = +2 D.$s$,1,-0.25),
(3,'Kinematics',$s$From a tower of height H, a particle is thrown vertically upwards with a speed u. The time taken by the particle to hit the ground is n times that taken to reach the highest point of its path. The relation between H, u and n is$s$,
 $s$[{"key":"A","text":"2gH = n^2·u^2"},{"key":"B","text":"gH = (n − 2)^2·u^3"},{"key":"C","text":"2gH = n·u^2·(n − 2)"},{"key":"D","text":"2gH = u^2·(n − 2)^2"}]$s$,'C',
 $s$Time to the highest point is u/g, so the total time is nu/g. Using −H = u(nu/g) − (1/2)g(nu/g)^2 and simplifying gives 2gH = n·u^2·(n − 2).$s$,1,-0.25),
(4,'Nuclei',$s$A radioactive element X (A = 242, Z = 92) emits two α-particles, one electron and two positrons. The transformed nucleus is Y (A = 234, Z = P). The value of P is$s$,
 $s$[{"key":"A","text":"85"},{"key":"B","text":"87"},{"key":"C","text":"92"},{"key":"D","text":"96"}]$s$,'B',
 $s$Change in atomic number: two α (−4), one electron (+1), two positrons (−2). So P = 92 − 4 + 1 − 2 = 87. The mass number 242 − 8 = 234 also matches.$s$,1,-0.25),
(5,'Units and Errors',$s$Density and volume of a body are given as (20 ± 4) g/cm^3 and (10 ± 1) cm^3 respectively. The absolute error in the measurement of mass is$s$,
 $s$[{"key":"A","text":"20 g"},{"key":"B","text":"30 g"},{"key":"C","text":"45 g"},{"key":"D","text":"60 g"}]$s$,'D',
 $s$m = ρV = 200 g. Relative error Δm/m = Δρ/ρ + ΔV/V = 4/20 + 1/10 = 0.3, so Δm = 0.3 × 200 = 60 g.$s$,1,-0.25),
(6,'Atoms (Bohr Model)',$s$The de-Broglie wavelength of an electron in the 4th orbit is (where r = radius of the 1st orbit)$s$,
 $s$[{"key":"A","text":"2πr"},{"key":"B","text":"4πr"},{"key":"C","text":"8πr"},{"key":"D","text":"16πr"}]$s$,'C',
 $s$The nth orbit holds n de-Broglie wavelengths: 4λ = 2π·r4, and r4 = 16r. So λ = 2π(16r)/4 = 8πr.$s$,2,-0.5)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- --------------------------------------------------------- WBJEE Chemistry
with p as (select id from public.pyq_papers where exam='WBJEE' and subject='Chemistry' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Chemical Kinetics',$s$In a first order reaction the concentration of reactant decreases from 400 mol L^−1 to 50 mol L^−1 in 7.5 × 10^3 s. The rate constant of the reaction is (approximately)$s$,
 $s$[{"key":"A","text":"1 × 10^−2 s^−1"},{"key":"B","text":"2.5 × 10^−3 s^−1"},{"key":"C","text":"1 × 10^−5 s^−1"},{"key":"D","text":"2.77 × 10^−4 s^−1"}]$s$,'D',
 $s$k = (2.303/t)·log(a0/a) = (2.303/7500)·log 8 ≈ 2.77 × 10^−4 s^−1.$s$,1::numeric,-0.25::numeric),
(2,'Coordination Compounds',$s$The calculated magnetic moment for low spin [Ru(EDTA)]^− is$s$,
 $s$[{"key":"A","text":"2.73 BM"},{"key":"B","text":"1.73 BM"},{"key":"C","text":"3.23 BM"},{"key":"D","text":"0.00 BM"}]$s$,'B',
 $s$Ru is in the +3 state (d^5). Low spin leaves one unpaired electron, so μ = √(n(n+2)) = √3 ≈ 1.73 BM.$s$,1,-0.25),
(3,'Solid State',$s$A compound contains two types of atoms A and B. Its crystal structure is a cubic lattice with 'A' atoms at the corners of the unit cell and 'B' atoms at the body centre. The simplest formula of the compound is$s$,
 $s$[{"key":"A","text":"A2B"},{"key":"B","text":"AB"},{"key":"C","text":"AB2"},{"key":"D","text":"AB3"}]$s$,'B',
 $s$Corner A atoms contribute 8 × 1/8 = 1 and the body-centre B atom contributes 1. Ratio A : B = 1 : 1, so the formula is AB.$s$,1,-0.25),
(4,'Chemical Bonding',$s$In which of the following species is sp^3d^2 hybridisation NOT associated?$s$,
 $s$[{"key":"A","text":"XeF6"},{"key":"B","text":"BrF6^+"},{"key":"C","text":"IF5"},{"key":"D","text":"XeF4"}]$s$,'A',
 $s$XeF6 has 7 electron pairs around Xe (6 bonds + 1 lone pair), so it is sp^3d^3. BrF6^+, IF5 and XeF4 each have 6 electron pairs and are sp^3d^2.$s$,1,-0.25),
(5,'Thermodynamics',$s$Three engines A, B and C take steam at 130°C and reject it at 20°C, 40°C and 50°C respectively. The most efficient engine will be$s$,
 $s$[{"key":"A","text":"A"},{"key":"B","text":"B"},{"key":"C","text":"C"},{"key":"D","text":"All the three engines will be equally efficient"}]$s$,'A',
 $s$Carnot efficiency η = 1 − T_sink/T_source rises as the sink temperature falls. Engine A rejects heat at the lowest temperature (20°C), so it is the most efficient.$s$,1,-0.25),
(6,'Ionic Equilibrium',$s$A buffer solution contains 100 mL of 0.01 M CH3COOH and 200 mL of 0.02 M CH3COONa. 700 mL of water is added subsequently. The pH before and after dilution are [pKa = 4.74; log 2 = 0.301]$s$,
 $s$[{"key":"A","text":"5.04, 5.04"},{"key":"B","text":"5.04, 0.504"},{"key":"C","text":"5.04, 1.54"},{"key":"D","text":"5.34, 5.34"}]$s$,'D',
 $s$Salt = 4 mmol and acid = 1 mmol. pH = pKa + log(salt/acid) = 4.74 + log 4 = 5.34. Dilution does not change the salt/acid ratio, so the pH stays 5.34.$s$,1,-0.25)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- --------------------------------------------------------- MHT-CET Physics
with p as (select id from public.pyq_papers where exam='MHT-CET' and subject='Physics' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Kinetic Theory',$s$For a gas, R/Cv = 0.4, where R is the universal gas constant and Cv is the molar specific heat at constant volume. The gas is made up of molecules which are$s$,
 $s$[{"key":"A","text":"monoatomic"},{"key":"B","text":"polyatomic"},{"key":"C","text":"non rigid diatomic"},{"key":"D","text":"rigid diatomic"}]$s$,'D',
 $s$R/Cv = 0.4 gives Cv = (5/2)R, so there are 5 degrees of freedom (3 translational + 2 rotational). That is a rigid diatomic gas.$s$,1::numeric,0::numeric),
(2,'Electrostatics',$s$If the radius of the spherical Gaussian surface is increased, then the electric flux due to a point charge enclosed by the surface$s$,
 $s$[{"key":"A","text":"increases"},{"key":"B","text":"remains unchanged"},{"key":"C","text":"is zero"},{"key":"D","text":"decreases"}]$s$,'B',
 $s$By Gauss's law the flux equals q/ε0 and depends only on the enclosed charge, which does not change when the sphere is enlarged.$s$,1,0),
(3,'Capacitors',$s$Initially, 'n' identical capacitors are joined in parallel and charged to potential 'V'. Now they are separated and joined in series. Then$s$,
 $s$[{"key":"A","text":"potential difference and total energy of the combination remain the same"},{"key":"B","text":"potential difference remains the same and energy increases 'n' times"},{"key":"C","text":"potential difference becomes 'nV' and energy remains the same"},{"key":"D","text":"potential difference is 'nV' and energy increases 'n' times"}]$s$,'C',
 $s$Each capacitor keeps its charge and voltage V. In series the voltages add to nV, while the total stored energy is just the sum of the unchanged individual energies.$s$,1,0),
(4,'Current Electricity',$s$In a potentiometer experiment, a null point is obtained at a particular point for a cell on a potentiometer wire 'x' cm long. If the length of the potentiometer wire is increased by a few cm without changing the cell (driving source not changed), the balancing length will$s$,
 $s$[{"key":"A","text":"decrease"},{"key":"B","text":"increase"},{"key":"C","text":"not change"},{"key":"D","text":"become zero"}]$s$,'B',
 $s$The same driving voltage is now spread over a longer wire, so the potential gradient falls. The cell's emf is unchanged, so the balancing length (emf/gradient) increases.$s$,1,0),
(5,'Alternating Current',$s$A light bulb connected in series with a capacitor and an a.c. source is glowing with a certain brightness. On reducing the value of capacitance and the frequency respectively, the brightness of the bulb$s$,
 $s$[{"key":"A","text":"is reduced, is reduced"},{"key":"B","text":"is more, is more"},{"key":"C","text":"is more, is reduced"},{"key":"D","text":"is reduced, is more"}]$s$,'A',
 $s$Xc = 1/(2πfC). Reducing either C or f raises Xc, which lowers the current, so the bulb gets dimmer in both cases.$s$,1,0),
(6,'Semiconductors',$s$In the energy band diagram of insulators, the band gap and the conduction band are respectively$s$,
 $s$[{"key":"A","text":"very high, empty"},{"key":"B","text":"very low, empty"},{"key":"C","text":"very high, completely filled"},{"key":"D","text":"very low, partially filled"}]$s$,'A',
 $s$Insulators have a very wide band gap that electrons cannot cross at room temperature, so the conduction band stays empty.$s$,1,0)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- ------------------------------------------------------- MHT-CET Chemistry
with p as (select id from public.pyq_papers where exam='MHT-CET' and subject='Chemistry' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Chemical Bonding',$s$Identify the different types of bonds present in quaternary ammonium salts.$s$,
 $s$[{"key":"A","text":"Covalent"},{"key":"B","text":"Ionic"},{"key":"C","text":"Covalent and co-ordinate"},{"key":"D","text":"Covalent, co-ordinate and ionic"}]$s$,'D',
 $s$In R4N+ X−, the N–C bonds are covalent, one N–C bond forms from nitrogen's lone pair (co-ordinate), and the cation and anion are held by an ionic bond.$s$,1::numeric,0::numeric),
(2,'Hydrocarbons',$s$Which of the following types of reactions is used to prepare alkyl benzene?$s$,
 $s$[{"key":"A","text":"Swartz reaction"},{"key":"B","text":"Sandmeyer reaction"},{"key":"C","text":"Finkelstein reaction"},{"key":"D","text":"Wurtz-Fittig reaction"}]$s$,'D',
 $s$The Wurtz-Fittig reaction couples an aryl halide with an alkyl halide using sodium in dry ether, giving an alkylbenzene.$s$,1,0),
(3,'d- and f-Block Elements',$s$Which of the following lanthanoids is radioactive?$s$,
 $s$[{"key":"A","text":"Tm"},{"key":"B","text":"Dy"},{"key":"C","text":"Eu"},{"key":"D","text":"Pm"}]$s$,'D',
 $s$Promethium (Z = 61) has no stable isotope and is radioactive. Tm, Dy and Eu all have stable isotopes.$s$,1,0),
(4,'d- and f-Block Elements',$s$Which transition series includes the elements Co and Mo respectively?$s$,
 $s$[{"key":"A","text":"4d and 5d"},{"key":"B","text":"5d and 6d"},{"key":"C","text":"3d and 4d"},{"key":"D","text":"3d and 6d"}]$s$,'C',
 $s$Cobalt (Z = 27) is in the 3d series and molybdenum (Z = 42) is in the 4d series.$s$,1,0),
(5,'Haloalkanes',$s$Which of the following compounds is formed when chloroform is exposed to air and light?$s$,
 $s$[{"key":"A","text":"Phosgene"},{"key":"B","text":"Phosphine"},{"key":"C","text":"Carbon dioxide"},{"key":"D","text":"Carbon tetrachloride"}]$s$,'A',
 $s$Chloroform is slowly oxidised by air in sunlight to the poisonous gas carbonyl chloride, COCl2 (phosgene).$s$,1,0),
(6,'Alcohols and Ethers',$s$What type of mechanism is followed by the dehydration of alcohol to form an ether?$s$,
 $s$[{"key":"A","text":"Nucleophilic substitution unimolecular reaction"},{"key":"B","text":"Nucleophilic substitution bimolecular reaction"},{"key":"C","text":"Electrophilic substitution reaction"},{"key":"D","text":"Electrophilic addition reaction"}]$s$,'B',
 $s$Ether formation proceeds by SN2: a second alcohol molecule acts as the nucleophile and displaces water from the protonated alcohol.$s$,1,0)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- --------------------------------------------------- CBSE Class 12 Physics
with p as (select id from public.pyq_papers where exam='CBSE Class 12' and subject='Physics' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Electrostatic Potential',$s$In a region, the electric potential varies as V = 10 − 50x, where V is in volts and x in metres. The electric field in the region is$s$,
 $s$[{"key":"A","text":"10 N/C along +x"},{"key":"B","text":"10 N/C along −x"},{"key":"C","text":"50 N/C along +x"},{"key":"D","text":"50 N/C along −x"}]$s$,'C',
 $s$E = −dV/dx = −(−50) = +50 V/m, so the field is 50 N/C along +x, the direction in which the potential falls.$s$,1::numeric,0::numeric),
(2,'Electromagnetic Waves',$s$An electromagnetic wave passes from vacuum into a dielectric medium with relative electrical permittivity 3/2 and relative magnetic permeability 8/3. Then, its$s$,
 $s$[{"key":"A","text":"wavelength is doubled and frequency remains unchanged."},{"key":"B","text":"wavelength is doubled and frequency is halved."},{"key":"C","text":"wavelength is halved and frequency remains unchanged."},{"key":"D","text":"wavelength and frequency both will remain unchanged."}]$s$,'C',
 $s$n = √(εr·μr) = √((3/2)(8/3)) = 2. Frequency does not change at the boundary, and wavelength = λ0/n, so it is halved.$s$,1,0),
(3,'Ray Optics',$s$A concave lens of focal length 10 cm is cut into two identical plano-concave lenses. The focal length of each lens will be$s$,
 $s$[{"key":"A","text":"20 cm"},{"key":"B","text":"30 cm"},{"key":"C","text":"40 cm"},{"key":"D","text":"5 cm"}]$s$,'A',
 $s$The full lens has 1/f = (n − 1)(2/R). Each half has only one curved surface, so 1/f' = (n − 1)(1/R) = 1/(2f), giving f' = 20 cm.$s$,1,0),
(4,'Wave Optics',$s$Four independent waves are expressed as (i) y1 = A1 sin ωt, (ii) y2 = A2 sin 2ωt, (iii) y3 = A3 cos ωt, (iv) y4 = A4 sin(ωt + π/3). The interference between two of these waves is possible in$s$,
 $s$[{"key":"A","text":"(i) and (iii) only"},{"key":"B","text":"(iii) and (iv) only"},{"key":"C","text":"(i), (iii) and (iv) only"},{"key":"D","text":"All of them"}]$s$,'C',
 $s$Sustained interference needs the same frequency and a constant phase difference. Waves (i), (iii) and (iv) all have frequency ω; wave (ii) has 2ω.$s$,1,0),
(5,'Semiconductors',$s$In an unbiased p-n junction, at equilibrium, which of the following statements is true?$s$,
 $s$[{"key":"A","text":"Diffusion current is zero but drift current exists."},{"key":"B","text":"Diffusion current exists but drift current is zero."},{"key":"C","text":"Diffusion and drift currents are equal and opposite."},{"key":"D","text":"Both the diffusion and drift currents exist but are unequal."}]$s$,'C',
 $s$At equilibrium the barrier potential grows until the drift current exactly balances the diffusion current, so the net current is zero.$s$,1,0),
(6,'Nuclei',$s$Assertion (A): The mass of a nucleus is less than the sum of the masses of the constituent nucleons.
Reason (R): Energy is absorbed when the nucleons are bound together to form a nucleus.$s$,
 $s$[{"key":"A","text":"Both (A) and (R) are true and (R) is the correct explanation of (A)."},{"key":"B","text":"Both (A) and (R) are true, but (R) is not the correct explanation of (A)."},{"key":"C","text":"(A) is true, but (R) is false."},{"key":"D","text":"Both (A) and (R) are false."}]$s$,'C',
 $s$The mass defect is real, so (A) is true. Binding energy is released, not absorbed, when nucleons bind, so (R) is false.$s$,1,0)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- ------------------------------------------------- CBSE Class 12 Chemistry
with p as (select id from public.pyq_papers where exam='CBSE Class 12' and subject='Chemistry' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Solutions',$s$Which of the following solutions will have the lowest freezing point in water?$s$,
 $s$[{"key":"A","text":"0.1 M Glucose"},{"key":"B","text":"0.1 M CaCl2"},{"key":"C","text":"0.1 M KCl"},{"key":"D","text":"0.1 M Urea"}]$s$,'B',
 $s$Freezing-point depression is proportional to i × m. CaCl2 gives 3 ions, KCl gives 2, glucose and urea do not dissociate. So CaCl2 freezes lowest.$s$,1::numeric,0::numeric),
(2,'d- and f-Block Elements',$s$Which of the following is not a transition metal?$s$,
 $s$[{"key":"A","text":"Sc"},{"key":"B","text":"Ag"},{"key":"C","text":"Hg"},{"key":"D","text":"Cu"}]$s$,'C',
 $s$Hg has a completely filled 5d10 subshell in its ground state and in its common oxidation states, so it is not counted as a transition metal.$s$,1,0),
(3,'Electrochemistry',$s$What will happen during the electrolysis of aqueous solution of CuCl2 by using platinum electrodes?$s$,
 $s$[{"key":"A","text":"Cu will deposit at anode"},{"key":"B","text":"H2 gas will be released at cathode"},{"key":"C","text":"O2 gas will be released at anode"},{"key":"D","text":"Cl2 gas will be released at anode"}]$s$,'D',
 $s$Cu2+ is reduced at the cathode, and Cl− is oxidised to Cl2 at the anode because of the overpotential for releasing O2.$s$,1,0),
(4,'Haloalkanes and Haloarenes',$s$Which of the following is 'not' true about enantiomers?$s$,
 $s$[{"key":"A","text":"They have the same chemical reactivity."},{"key":"B","text":"They have the same specific rotation."},{"key":"C","text":"They have the same melting or boiling point."},{"key":"D","text":"They have the same refractive index."}]$s$,'B',
 $s$Enantiomers share physical properties, but their specific rotations are equal in size and opposite in sign, so they are not the same.$s$,1,0),
(5,'Solutions',$s$Assertion (A): It is not possible to separate the components of an azeotrope by fractional distillation.
Reason (R): Components of an azeotrope have the same composition in liquid and vapour phase and boil at a constant temperature.$s$,
 $s$[{"key":"A","text":"Both (A) and (R) are true and (R) is the correct explanation of (A)."},{"key":"B","text":"Both (A) and (R) are true, but (R) is not the correct explanation of (A)."},{"key":"C","text":"(A) is true, but (R) is false."},{"key":"D","text":"(A) is false, but (R) is true."}]$s$,'A',
 $s$An azeotrope's vapour has the same composition as the liquid and it boils at a constant temperature, so distillation cannot enrich either component. (R) explains (A).$s$,1,0),
(6,'Alcohols, Phenols and Ethers',$s$Assertion (A): The presence of –OH group in phenols directs the incoming group to meta position in the ring.
Reason (R): –OH group in phenols activates the aromatic ring towards electrophilic substitution reaction.$s$,
 $s$[{"key":"A","text":"Both (A) and (R) are true and (R) is the correct explanation of (A)."},{"key":"B","text":"Both (A) and (R) are true, but (R) is not the correct explanation of (A)."},{"key":"C","text":"(A) is true, but (R) is false."},{"key":"D","text":"(A) is false, but (R) is true."}]$s$,'D',
 $s$–OH donates electrons into the ring by resonance, which activates it and makes it an ortho/para director, not meta. So (A) is false and (R) is true.$s$,1,0)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- ----------------------------------------------- CBSE Class 12 Mathematics
with p as (select id from public.pyq_papers where exam='CBSE Class 12' and subject='Mathematics' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Inverse Trigonometric Functions',$s$If 2cos^−1(x) = y, then$s$,
 $s$[{"key":"A","text":"0 ≤ y ≤ π"},{"key":"B","text":"−π ≤ y ≤ π"},{"key":"C","text":"0 ≤ y ≤ 2π"},{"key":"D","text":"−π ≤ y ≤ 0"}]$s$,'C',
 $s$The principal range of cos^−1(x) is [0, π]. Doubling it gives 0 ≤ y ≤ 2π.$s$,1::numeric,0::numeric),
(2,'Matrices',$s$Which of the following properties is/are true for two matrices of suitable orders?
(i) (A + B)' = A' + B'
(ii) (A − B)' = B' − A'
(iii) (AB)' = A'B'
(iv) (kAB)' = kB'A' (k is a scalar)$s$,
 $s$[{"key":"A","text":"(i) only"},{"key":"B","text":"(i), (ii) and (iii)"},{"key":"C","text":"(i) and (ii)"},{"key":"D","text":"(i) and (iv)"}]$s$,'D',
 $s$(i) is true. (A − B)' = A' − B', so (ii) is false. (AB)' = B'A', so (iii) is false and (iv) is true.$s$,1,0),
(3,'Matrices',$s$If A and B are skew symmetric matrices of same order, then which of the following matrices is also skew symmetric?$s$,
 $s$[{"key":"A","text":"AB"},{"key":"B","text":"AB + BA"},{"key":"C","text":"(A + B)^2"},{"key":"D","text":"A − B"}]$s$,'D',
 $s$(A − B)' = A' − B' = −A + B = −(A − B), so A − B is skew symmetric. AB + BA and (A + B)^2 are symmetric.$s$,1,0),
(4,'Application of Derivatives',$s$The least value of f(x) = x^3 − 12x, x ∈ [0, 3] is$s$,
 $s$[{"key":"A","text":"−16"},{"key":"B","text":"−9"},{"key":"C","text":"0"},{"key":"D","text":"16"}]$s$,'A',
 $s$f'(x) = 3x^2 − 12 = 0 gives x = 2. f(0) = 0, f(2) = −16, f(3) = −9, so the least value is −16.$s$,1,0),
(5,'Linear Programming',$s$The degree of an objective function of a linear programming problem is$s$,
 $s$[{"key":"A","text":"0"},{"key":"B","text":"1"},{"key":"C","text":"2"},{"key":"D","text":"Any natural number"}]$s$,'B',
 $s$The objective function Z = ax + by is linear, so its degree is 1.$s$,1,0),
(6,'Three Dimensional Geometry',$s$Assertion (A): Lines given by x = py + q, z = ry + s and x = p'y + q', z = r'y + s' are perpendicular to each other when pp' + rr' = 1.
Reason (R): Two lines r = a1 + λb1 and r = a2 + μb2 are perpendicular to each other if b1 · b2 = 0.$s$,
 $s$[{"key":"A","text":"Both (A) and (R) are true and (R) is the correct explanation of (A)."},{"key":"B","text":"Both (A) and (R) are true, but (R) is not the correct explanation of (A)."},{"key":"C","text":"(A) is true and (R) is false."},{"key":"D","text":"(A) is false and (R) is true."}]$s$,'D',
 $s$Direction ratios are (p, 1, r) and (p', 1, r'). They are perpendicular when pp' + 1 + rr' = 0, i.e. pp' + rr' = −1, so (A) is false. (R) is the correct condition, so it is true.$s$,1,0)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- ------------------------------------------ CBSE Class 12 Computer Science
with p as (select id from public.pyq_papers where exam='CBSE Class 12' and subject='Computer Science' and year=2026)
insert into public.pyq_questions (paper_id,q_no,topic,qtype,stem,options,correct_key,solution,marks_correct,marks_wrong)
select p.id, v.q_no, v.topic, 'mcq', v.stem, v.options::jsonb, v.correct_key, v.solution, v.mc, v.mw from p, (values
(1,'Python Strings',$s$Identify the output of the following code snippet:
s = "the Truth"
print(s.capitalize())$s$,
 $s$[{"key":"A","text":"The truth"},{"key":"B","text":"THE TRUTH"},{"key":"C","text":"The Truth"},{"key":"D","text":"the Truth"}]$s$,'A',
 $s$capitalize() makes the first character uppercase and all the other characters lowercase.$s$,1::numeric,0::numeric),
(2,'Python Strings',$s$What is the output of the following code snippet?
s = 'War and Peace by Leo Tolstoy'
print(s.partition("by"))$s$,
 $s$[{"key":"A","text":"('War and Peace ', 'by', ' Leo Tolstoy')"},{"key":"B","text":"['War and Peace ', 'by', ' Leo Tolstoy']"},{"key":"C","text":"('War and Peace ', ' Leo Tolstoy')"},{"key":"D","text":"['War and Peace ', ' Leo Tolstoy']"}]$s$,'A',
 $s$partition() returns a 3-tuple: the part before the separator, the separator, and the part after it.$s$,1,0),
(3,'Python Tuples',$s$What will be the output of the following code snippet?
t = tuple('tuple')
t2 = t[2],
t += t2
print(t)$s$,
 $s$[{"key":"A","text":"('tuple')"},{"key":"B","text":"('tuple', 'p')"},{"key":"C","text":"('t', 'u', 'p', 'l', 'e', 'p')"},{"key":"D","text":"('t', 'u', 'p', 'l', 'e')"}]$s$,'C',
 $s$tuple('tuple') is ('t','u','p','l','e'). The trailing comma makes t2 the tuple ('p',), and += appends it.$s$,1,0),
(4,'Python Lists',$s$If L is a list with 6 elements, then which of the following statements will raise an exception?$s$,
 $s$[{"key":"A","text":"L.pop(1)"},{"key":"B","text":"L.pop(6)"},{"key":"C","text":"L.insert(1, 6)"},{"key":"D","text":"L.insert(6, 1)"}]$s$,'B',
 $s$Valid indices are 0 to 5, so L.pop(6) raises IndexError. insert() never raises for an out-of-range index; it just adds at the end.$s$,1,0),
(5,'Database Concepts',$s$A relation in MySQL database consists of 2 tuples and 3 attributes. If 2 attributes are deleted and 4 tuples are added, what will be the cardinality of the relation?$s$,
 $s$[{"key":"A","text":"4"},{"key":"B","text":"5"},{"key":"C","text":"6"},{"key":"D","text":"7"}]$s$,'C',
 $s$Cardinality is the number of tuples: 2 + 4 = 6. Deleting attributes only changes the degree.$s$,1,0),
(6,'Python Data Types',$s$Assertion (A): [1,2,3] + '123' is an invalid expression in Python.
Reason (R): In Python, a list cannot be concatenated with a string.$s$,
 $s$[{"key":"A","text":"Both (A) and (R) are true and (R) is the correct explanation for (A)."},{"key":"B","text":"Both (A) and (R) are true and (R) is not the correct explanation for (A)."},{"key":"C","text":"(A) is true, but (R) is false."},{"key":"D","text":"(A) is false, but (R) is true."}]$s$,'A',
 $s$Using + between a list and a str raises TypeError, because a list can only be concatenated with another list. (R) explains (A).$s$,1,0)
) as v(q_no,topic,stem,options,correct_key,solution,mc,mw);

-- ------------------------------------------------------- sync denorm counts
update public.pyq_papers p
set total_questions = (select count(*) from public.pyq_questions q where q.paper_id = p.id),
    updated_at = now()
where p.exam in ('WBJEE','MHT-CET','CBSE Class 12') and p.year = 2026;
