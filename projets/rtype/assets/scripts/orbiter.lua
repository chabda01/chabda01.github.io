-- Orbiter : entre par la droite, puis tourne en cercle autour d'un point en tirant trois missiles à la fois.
local CENTER_X = 900   -- le point autour duquel il tourne
local RADIUS = 120

return {
    health = 4,
    score = 250,
    width = 56, height = 56,
    sprite = "turret",
    fire_cooldown = 1.2,
    missile_speed = 260,

    update = function(self, dt, game)
        if self.x > CENTER_X + RADIUS then
            -- Il entre en ligne droite.
            self.x = self.x - 160 * dt
        else
            -- Puis il tourne. `self` garde tout ce qu'on y range : ici l'angle.
            self.angle = (self.angle or 0) + 1.6 * dt
            self.x = CENTER_X + RADIUS * math.cos(self.angle)
            self.y = self.origin_y + RADIUS * math.sin(self.angle)
        end
    end,

    fire = function(self, game)
        -- Trois missiles vers la gauche : un tout droit, un qui monte, un qui descend.
        for slope = -1, 1 do
            game.shoot(-260, slope * 90)
        end
    end,
}
