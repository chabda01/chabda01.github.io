-- Zigzag : un monstre qui zigzague de haut en bas en avançant, et tire vers le joueur.
--
-- Pour créer un monstre : copiez ce fichier, changez les valeurs, puis écrivez "script:<nom du fichier>"
-- comme type de vague dans un niveau (voir docs/developer/scripting.md). Aucun C++ à toucher.
return {
    health = 2,            -- points de vie (la difficulté les multiplie)
    score = 150,           -- points donnés au joueur qui le tue
    width = 48, height = 48,
    sprite = "bydos",      -- image côté client : bydos, kamikaze, turret ou snake
    fire_cooldown = 1.8,   -- secondes entre deux tirs (0 = il ne tire pas)
    missile_speed = 300,   -- vitesse de ses missiles, en pixels par seconde

    -- Appelé à chaque tick.
    --   self.x, self.y     : sa position (changez-les pour le déplacer)
    --   self.time          : secondes depuis son apparition
    --   self.origin_x/_y   : l'endroit où il est apparu
    --   dt                 : secondes depuis le tick précédent
    update = function(self, dt, game)
        self.x = self.x - 140 * dt
        self.y = self.origin_y + 110 * math.sin(self.time * 3.5)
    end,

    -- Appelé quand son arme est prête (facultatif : sans cette fonction, il tire vers le joueur).
    fire = function(self, game)
        local px, py = game.nearest_player()
        if px then
            game.shoot_at(px, py)
        end
    end,
}
