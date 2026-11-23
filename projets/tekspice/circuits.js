/* Circuits de la démo.
   REPO : les fichiers .nts du dossier test/ du projet, copiés tels quels.
   PAGE : circuits écrits pour cette page, dans le même format. Fichier généré. */
(function(root){var D={REPO:[
 {
  "file": "test/chained_and.nts",
  "text": "# Chained AND gates\n.chipsets:\ninput i0\ninput i1\ninput i2\noutput out\nand gate1\nand gate2\n\n.links:\ni0:1 gate1:1\ni1:1 gate1:2\ngate1:3 gate2:1\ni2:1 gate2:2\ngate2:3 out:1\n"
 },
 {
  "file": "test/comments.nts",
  "text": "# Test file with comments\n.chipsets:\ninput a  # inline comment\ninput b\noutput s\n# full line comment\nand g\n\n.links:\na:1 g:1  # link comment\nb:1 g:2\ng:3 s:1\n"
 },
 {
  "file": "test/err_bad_link_format.nts",
  "text": ".chipsets:\ninput a\noutput o\n.links:\na:1\n"
 },
 {
  "file": "test/err_duplicate_name.nts",
  "text": ".chipsets:\ninput a\ninput a\n.links:\n"
 },
 {
  "file": "test/err_empty.nts",
  "text": ""
 },
 {
  "file": "test/err_garbage_line.nts",
  "text": ".chipsets:\ninput a\ngarbage line here\noutput o\n.links:\na:1 o:1\n"
 },
 {
  "file": "test/err_no_chipsets.nts",
  "text": "garbage content\n"
 },
 {
  "file": "test/err_unknown_component_link.nts",
  "text": ".chipsets:\ninput a\noutput o\n.links:\na:1 unknown:1\n"
 },
 {
  "file": "test/err_unknown_type.nts",
  "text": ".chipsets:\nunknown_type test\n.links:\n"
 },
 {
  "file": "test/example.nts",
  "text": "# three inputs and gate\n.chipsets:\ninput i0\ninput i1\ninput i2\n4081 and0\noutput out\n.links:\ni0:1 and0:1\ni1:1 and0:2\nand0:3 and0:5\ni2:1 and0:6\nand0:4 out:1\n"
 },
 {
  "file": "test/gate_4001.nts",
  "text": "# NOR logic gate (4001) - test gate 1 only\n.chipsets:\ninput in_01\ninput in_02\noutput out_03\n4001 gate\n\n.links:\nin_01:1 gate:1\nin_02:1 gate:2\nout_03:1 gate:3\n"
 },
 {
  "file": "test/gate_4011.nts",
  "text": "# NAND logic gate (4011) - test gate 1 only\n.chipsets:\ninput in_01\ninput in_02\noutput out_03\n4011 gate\n\n.links:\nin_01:1 gate:1\nin_02:1 gate:2\nout_03:1 gate:3\n"
 },
 {
  "file": "test/gate_4030.nts",
  "text": "# XOR logic gate (4030) - test gate 1 only\n.chipsets:\ninput in_01\ninput in_02\noutput out_03\n4030 gate\n\n.links:\nin_01:1 gate:1\nin_02:1 gate:2\nout_03:1 gate:3\n"
 },
 {
  "file": "test/gate_4069.nts",
  "text": "# NOT logic gate (4069) - test gate 1 only\n.chipsets:\ninput in_01\noutput out_02\n4069 gate\n\n.links:\nin_01:1 gate:1\nout_02:1 gate:2\n"
 },
 {
  "file": "test/gate_4071.nts",
  "text": "# OR logic gate (4071) - test gate 1 only\n.chipsets:\ninput in_01\ninput in_02\noutput out_03\n4071 gate\n\n.links:\nin_01:1 gate:1\nin_02:1 gate:2\nout_03:1 gate:3\n"
 },
 {
  "file": "test/gate_4081.nts",
  "text": "# Test of AND logic gate (4081)\n#\n#           +---------4081---------+\n# in_01  -1-|>-+---\\       ignored-|-14-\n#           |  | &  |-+            |\n# in_02  -2-|>-+---/  |     /---+-<|-13- in_13\n#           |         |  +-|  & |  |\n# out_03 -3-|<--------+  |  \\---+-<|-12- in_12\n#           |            |         |\n# out_04 -4-|<--------+  +-------->|-11- out_11\n#           |         |            |\n# in_05  -5-|>-+---\\  |  +-------->|-10- out_10\n#           |  | &  |-+  |         |\n# in_06  -6-|>-+---/     |  /---+-<|-9-  in_09\n#           |            +-|  & |  |\n#        -7-|-ignored       \\---+-<|-8-  in_08\n#           +----------------------+\n\n.chipsets:\ninput in_01\ninput in_02\noutput out_03\noutput out_04\ninput in_05\ninput in_06\ninput in_08\ninput in_09\noutput out_10\noutput out_11\ninput in_12\ninput in_13\n4081 gate\n\n.links:\nin_01:1 gate:1\nin_02:1 gate:2\nout_03:1 gate:3\nout_04:1 gate:4\nin_05:1 gate:5\nin_06:1 gate:6\nin_08:1 gate:8\nin_09:1 gate:9\nout_10:1 gate:10\nout_11:1 gate:11\nin_12:1 gate:12\nin_13:1 gate:13\n"
 },
 {
  "file": "test/simple_and.nts",
  "text": ".chipsets:\ninput a\ninput b\noutput s\nand g\n.links:\na:1 g:1\nb:1 g:2\ng:3 s:1\n"
 },
 {
  "file": "test/simple_clock.nts",
  "text": ".chipsets:\nclock cl\noutput s\n.links:\ncl:1 s:1\n"
 },
 {
  "file": "test/simple_false.nts",
  "text": ".chipsets:\nfalse f\noutput s\n.links:\nf:1 s:1\n"
 },
 {
  "file": "test/simple_input_output.nts",
  "text": "# Basic wire\n.chipsets:\ninput i\noutput o\n\n.links:\ni:1 o:1\n"
 },
 {
  "file": "test/simple_not.nts",
  "text": ".chipsets:\ninput a\noutput s\nnot g\n.links:\na:1 g:1\ng:2 s:1\n"
 },
 {
  "file": "test/simple_or.nts",
  "text": ".chipsets:\ninput a\ninput b\noutput s\nor g\n.links:\na:1 g:1\nb:1 g:2\ng:3 s:1\n"
 },
 {
  "file": "test/simple_true.nts",
  "text": ".chipsets:\ntrue t\noutput s\n.links:\nt:1 s:1\n"
 },
 {
  "file": "test/simple_xor.nts",
  "text": ".chipsets:\ninput a\ninput b\noutput s\nxor g\n.links:\na:1 g:1\nb:1 g:2\ng:3 s:1\n"
 },
 {
  "file": "test/three_input_and.nts",
  "text": ".chipsets:\ninput i0\ninput i1\ninput i2\noutput out\nand g1\nand g2\n.links:\ni0:1 g1:1\ni1:1 g1:2\ng1:3 g2:1\ni2:1 g2:2\ng2:3 out:1\n"
 }
],
PAGE:[
 {
  "file": "additionneur.nts",
  "label": "Additionneur complet",
  "hint": "Trois entrées a, b et cin. La sortie s est la somme, cout la retenue. Le scénario essaie 1 + 1, puis 1 + 1 + 1.",
  "script": [
   "a=1",
   "b=1",
   "cin=0",
   "simulate",
   "display",
   "cin=1",
   "simulate",
   "display"
  ],
  "text": "# Additionneur complet 1 bit : s = a + b + cin, cout = retenue\n.chipsets:\ninput a\ninput b\ninput cin\nxor x1\nxor x2\nand a1\nand a2\nor o1\noutput s\noutput cout\n\n.links:\na:1 x1:1\nb:1 x1:2\nx1:3 x2:1\ncin:1 x2:2\nx2:3 s:1\na:1 a1:1\nb:1 a1:2\nx1:3 a2:1\ncin:1 a2:2\na1:3 o1:1\na2:3 o1:2\no1:3 cout:1\n"
 },
 {
  "file": "vote.nts",
  "label": "Vote 2 sur 3",
  "hint": "Trois capteurs. L'alarme passe à 1 dès que deux capteurs sur trois sont à 1.",
  "script": [
   "capteur_a=1",
   "capteur_b=0",
   "capteur_c=0",
   "simulate",
   "display",
   "capteur_c=1",
   "simulate",
   "display"
  ],
  "text": "# Vote a la majorite : la sortie vaut 1 si au moins 2 capteurs sur 3 disent 1\n.chipsets:\ninput capteur_a\ninput capteur_b\ninput capteur_c\nand ab\nand bc\nand ac\nor o1\nor o2\noutput alarme\n\n.links:\ncapteur_a:1 ab:1\ncapteur_b:1 ab:2\ncapteur_b:1 bc:1\ncapteur_c:1 bc:2\ncapteur_a:1 ac:1\ncapteur_c:1 ac:2\nab:3 o1:1\nbc:3 o1:2\no1:3 o2:1\nac:3 o2:2\no2:3 alarme:1\n"
 },
 {
  "file": "multiplexeur.nts",
  "label": "Multiplexeur",
  "hint": "L'entrée sel choisit laquelle des deux entrées a ou b est recopiée sur la sortie.",
  "script": [
   "a=1",
   "b=0",
   "sel=0",
   "simulate",
   "display",
   "sel=1",
   "simulate",
   "display"
  ],
  "text": "# Multiplexeur 2 vers 1 : sel = 0 -> la sortie recopie a ; sel = 1 -> elle recopie b\n.chipsets:\ninput a\ninput b\ninput sel\nnot n\nand ga\nand gb\nor o\noutput out\n\n.links:\nsel:1 n:1\na:1 ga:1\nn:2 ga:2\nb:1 gb:1\nsel:1 gb:2\nga:3 o:1\ngb:3 o:2\no:3 out:1\n"
 },
 {
  "file": "egalite.nts",
  "label": "Égalité 2 bits (4030)",
  "hint": "Deux portes XOR de la même puce 4030, côte à côte. La sortie vaut 1 quand les deux nombres sont égaux.",
  "script": [
   "a0=1",
   "a1=0",
   "b0=1",
   "b1=0",
   "simulate",
   "display",
   "b1=1",
   "simulate",
   "display"
  ],
  "text": "# Egalite de deux nombres de 2 bits (a1 a0 et b1 b0) avec une puce 4030\n# Les deux portes XOR de la puce travaillent cote a cote.\n.chipsets:\ninput a0\ninput a1\ninput b0\ninput b1\n4030 puce\nnor n\noutput egal\n\n.links:\na0:1 puce:1\nb0:1 puce:2\na1:1 puce:5\nb1:1 puce:6\npuce:3 n:1\npuce:4 n:2\nn:3 egal:1\n"
 },
 {
  "file": "horloge.nts",
  "label": "Horloge",
  "hint": "Une horloge reste indéfinie tant qu'on ne lui a pas donné de valeur. Le scénario lui donne 0, puis lance loop.",
  "script": [
   "cl=0",
   "valide=1",
   "simulate",
   "display",
   "loop"
  ],
  "text": "# Horloge : elle change d'etat a chaque tick, une entree la laisse passer ou non\n.chipsets:\nclock cl\ninput valide\nand g\nnot inv\noutput s\noutput n_cl\n\n.links:\ncl:1 g:1\nvalide:1 g:2\ng:3 s:1\ncl:1 inv:1\ninv:2 n_cl:1\n"
 },
 {
  "file": "boucle.nts",
  "label": "Boucle (bascule RS)",
  "hint": "Deux portes NOR branchées l'une sur l'autre. Avec set = 1 ou reset = 1 la sortie est connue. Avec les deux à 0, le simulateur tombe sur la boucle et répond U.",
  "script": [
   "set=1",
   "reset=0",
   "simulate",
   "display",
   "set=0",
   "simulate",
   "display"
  ],
  "text": "# Bascule RS en portes NOR : chaque sortie revient sur l'autre porte (boucle)\n.chipsets:\ninput set\ninput reset\nnor n1\nnor n2\noutput q\noutput nq\n\n.links:\nreset:1 n1:1\nn2:3 n1:2\nset:1 n2:1\nn1:3 n2:2\nn1:3 q:1\nn2:3 nq:1\n"
 }
]};
if(typeof module==='object'&&module.exports)module.exports=D;else root.NTS_CIRCUITS=D;})(typeof self!=='undefined'?self:this);
